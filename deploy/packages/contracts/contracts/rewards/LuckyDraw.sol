// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LuckyDraw — Weekly Lucky Draw (1% of Marketing Pool)
/// @notice Receives 2.86% (286 BPS) of the marketing pool from RewardDistributor.
///         Stores USDT until admin triggers a weekly draw.
///
///         Weekly draw cap: $5,000 USDT per draw.
///         18 prizes per draw:
///           1st  ×1  — 30% of pool
///           2nd  ×2  — 10% each
///           3rd  ×5  —  5% each
///           Consolation ×10 — 2.5% each
///           Total = 100%
///
///         Excess beyond $5K cap → swept to TreasuryDAO by admin via sweepExcess().
///
/// @dev Phase 1 (Testnet): No Chainlink VRF. Admin supplies a randomSeed.
///      Fisher-Yates shuffle is applied to the participant list using that seed.
///      Deterministic: same seed + same participants → same winners.
contract LuckyDraw is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────

    /// @notice Role granted to RewardDistributor — may call receiveUSDT().
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // ─────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────

    /// @notice Weekly draw cap in USDT (6 decimals).
    uint256 public constant WEEKLY_CAP = 5_000 * 10 ** 6; // $5,000

    /// @notice Total number of prizes per draw.
    uint256 public constant PRIZE_COUNT = 18;

    // Prize BPS (out of 10000), all 18 prizes sum to 10000:
    // 1×3000 + 2×1000 + 5×500 + 10×250 = 3000+2000+2500+2500 = 10000 ✓
    uint256 private constant BPS_1ST         = 3000; // 30% — rank 0
    uint256 private constant BPS_2ND         = 1000; // 10% each — rank 1,2
    uint256 private constant BPS_3RD         =  500; //  5% each — rank 3–7
    uint256 private constant BPS_CONSOLATION =  250; //  2.5% each — rank 8–17

    // ─────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────

    /// @notice USDT token (6 decimals on BSC).
    IERC20 public immutable usdt;

    /// @notice Accumulated USDT balance waiting to be drawn.
    uint256 private _balance;

    // ─────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────

    /// @notice Thrown when startDraw is called with fewer than 18 participants.
    error NotEnoughParticipants(uint256 given, uint256 required);

    /// @notice Thrown when startDraw is called but balance is 0.
    error InsufficientBalance();

    // ─────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────

    /// @notice Emitted when USDT is received from RewardDistributor.
    event USDTReceived(uint256 amount, uint256 newBalance);

    /// @notice Emitted for each prize awarded during a draw.
    /// @param drawId   Monotonically increasing draw counter (0-indexed).
    /// @param winner   Address of the winner.
    /// @param rank     0 = 1st, 1-2 = 2nd, 3-7 = 3rd, 8-17 = consolation.
    /// @param amount   USDT amount transferred to winner.
    event PrizeAwarded(uint256 indexed drawId, address indexed winner, uint256 rank, uint256 amount);

    /// @notice Emitted when excess USDT is swept to treasury.
    event ExcessSwept(address indexed treasury, uint256 amount);

    // ─────────────────────────────────────────────────────────
    // Draw counter
    // ─────────────────────────────────────────────────────────

    /// @notice Number of draws completed.
    uint256 public drawCount;

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    /// @param _usdt  Address of the USDT token (6 decimals).
    /// @param _admin Address of the initial admin (DEFAULT_ADMIN_ROLE).
    constructor(address _usdt, address _admin) {
        require(_usdt  != address(0), "LuckyDraw: zero USDT");
        require(_admin != address(0), "LuckyDraw: zero admin");

        usdt = IERC20(_usdt);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ─────────────────────────────────────────────────────────
    // View functions
    // ─────────────────────────────────────────────────────────

    /// @notice Weekly draw cap constant — $5,000 USDT.
    function weeklyBudget() external pure returns (uint256) {
        return WEEKLY_CAP;
    }

    /// @notice Current accumulated USDT balance.
    function currentBalance() external view returns (uint256) {
        return _balance;
    }

    // ─────────────────────────────────────────────────────────
    // receiveUSDT
    // ─────────────────────────────────────────────────────────

    /// @notice Called by RewardDistributor to deposit USDT for the weekly draw.
    /// @param amount Amount of USDT to deposit (pulled from caller).
    function receiveUSDT(uint256 amount) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        _balance += amount;
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        emit USDTReceived(amount, _balance);
    }

    // ─────────────────────────────────────────────────────────
    // startDraw
    // ─────────────────────────────────────────────────────────

    /// @notice Admin triggers the weekly lucky draw.
    ///
    ///         Phase 1 — no VRF: admin provides a randomSeed for deterministic shuffle.
    ///         Uses Fisher-Yates shuffle on the participants array.
    ///         Only the first 18 shuffled participants win prizes.
    ///
    ///         The pool for this draw = min(_balance, WEEKLY_CAP).
    ///         The full pool is distributed; _balance is reduced by pool amount.
    ///
    /// @param participants List of eligible participant addresses. Must have ≥ 18 entries.
    /// @param randomSeed   Seed for the Fisher-Yates shuffle.
    function startDraw(
        address[] calldata participants,
        uint256 randomSeed
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (participants.length < PRIZE_COUNT) {
            revert NotEnoughParticipants(participants.length, PRIZE_COUNT);
        }
        if (_balance == 0) {
            revert InsufficientBalance();
        }

        // Determine pool: min(balance, cap)
        uint256 pool = _balance < WEEKLY_CAP ? _balance : WEEKLY_CAP;
        _balance -= pool;

        // Copy participants into memory for Fisher-Yates in-place shuffle
        address[] memory list = new address[](participants.length);
        for (uint256 i = 0; i < participants.length; i++) {
            list[i] = participants[i];
        }

        // Fisher-Yates shuffle: pick 18 winners
        uint256 currentDrawId = drawCount++;
        uint256 seed = randomSeed;

        for (uint256 i = 0; i < PRIZE_COUNT; i++) {
            // Pick a random index in [i, list.length)
            uint256 remaining = list.length - i;
            seed = uint256(keccak256(abi.encodePacked(seed, i)));
            uint256 j = i + (seed % remaining);

            // Swap list[i] and list[j]
            address tmp = list[i];
            list[i] = list[j];
            list[j] = tmp;

            // Determine prize amount for rank i
            uint256 prizeAmount = _prizeAmount(pool, i);

            // Transfer prize to winner
            usdt.safeTransfer(list[i], prizeAmount);

            emit PrizeAwarded(currentDrawId, list[i], i, prizeAmount);
        }
    }

    // ─────────────────────────────────────────────────────────
    // sweepExcess
    // ─────────────────────────────────────────────────────────

    /// @notice Sends USDT above the $5K weekly cap to the DAO Treasury.
    ///         No-op if balance ≤ WEEKLY_CAP.
    /// @param treasury Address to receive the excess USDT.
    function sweepExcess(address treasury) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (_balance <= WEEKLY_CAP) return;
        uint256 excess = _balance - WEEKLY_CAP;
        _balance = WEEKLY_CAP;
        usdt.safeTransfer(treasury, excess);
        emit ExcessSwept(treasury, excess);
    }

    // ─────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────

    /// @dev Returns USDT prize amount for a given rank (0–17).
    ///      rank 0        → 30% of pool
    ///      rank 1–2      → 10% each
    ///      rank 3–7      → 5% each
    ///      rank 8–17     → 2.5% each
    function _prizeAmount(uint256 pool, uint256 rank) internal pure returns (uint256) {
        if (rank == 0) {
            return pool * BPS_1ST / 10_000;
        } else if (rank <= 2) {
            return pool * BPS_2ND / 10_000;
        } else if (rank <= 7) {
            return pool * BPS_3RD / 10_000;
        } else {
            return pool * BPS_CONSOLATION / 10_000;
        }
    }
}
