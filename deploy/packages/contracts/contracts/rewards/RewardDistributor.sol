// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RewardDistributor — 35% Marketing Splitter to 4 Sub-contracts
/// @notice Receives the 35% Marketing & Sales portion from RevenueRouter and
///         distributes it to ClaimRewards, PeriodicRewards, LuckyDraw, and IncentivePool
///         using BPS weights.
///         BPS values are DAO-adjustable with ±200 BPS per change and 14-day cooldown.
contract RewardDistributor is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────

    /// @notice Only addresses with this role may call receiveAndDistribute().
    /// Granted to RevenueRouter.
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // ─────────────────────────────────────────────────────────
    // State — token
    // ─────────────────────────────────────────────────────────

    /// @notice USDT token address (6 decimals on BSC)
    IERC20 public immutable usdt;

    // ─────────────────────────────────────────────────────────
    // State — recipients
    // ─────────────────────────────────────────────────────────

    /// @notice ClaimRewards contract — Referral Reserve 10% + Community Builder 5% + GV Bonus 9%
    address public claimRewards;

    /// @notice PeriodicRewards contract — Monthly NFT Pool 7.5%
    address public periodicRewards;

    /// @notice LuckyDraw contract — Weekly Lucky Draw 1%
    address public luckyDraw;

    /// @notice IncentivePool contract — DAO-governed incentives 2.5%
    address public incentivePool;

    // ─────────────────────────────────────────────────────────
    // State — BPS weights (out of 10000)
    // ─────────────────────────────────────────────────────────

    /// @notice BPS for ClaimRewards: Referral 10% + Community Builder 5% + GV 9% = 24% of 35%
    ///         24 / 35 * 10000 = 6857.142... ≈ 6857
    uint256 public bpsClaim;     // Default 6857

    /// @notice BPS for PeriodicRewards: Monthly NFT Pool 7.5% = 7.5% of 35%
    ///         7.5 / 35 * 10000 = 2142.857... ≈ 2143
    uint256 public bpsPeriodic;  // Default 2143

    /// @notice BPS for LuckyDraw: 1% of 35%
    ///         1 / 35 * 10000 = 285.714... ≈ 286
    uint256 public bpsLucky;     // Default 286

    /// @notice BPS for IncentivePool: 2.5% of 35% (last recipient absorbs rounding dust)
    ///         2.5 / 35 * 10000 = 714.285... ≈ 714
    ///         6857 + 2143 + 286 + 714 = 10000
    uint256 public bpsIncentive; // Default 714

    // ─────────────────────────────────────────────────────────
    // State — cooldown
    // ─────────────────────────────────────────────────────────

    uint256 public constant BPS_ADJUSTMENT_COOLDOWN = 14 days;
    uint256 public constant MAX_BPS_CHANGE          = 200;  // ±2% per adjustment
    uint256 public constant BPS_TOTAL               = 10_000;

    /// @notice Timestamp of the last BPS adjustment (0 = never adjusted)
    uint256 public lastAdjustmentTime;

    // ─────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────

    /// @notice Emitted whenever rewards are distributed across the 4 sub-contracts
    event RewardDistributed(address indexed caller, uint256 totalAmount);

    /// @notice Emitted when BPS weights are adjusted by DAO
    event BPSAdjusted(
        uint256 claim,
        uint256 periodic,
        uint256 lucky,
        uint256 incentive
    );

    /// @notice Emitted when a recipient address is updated
    event RecipientUpdated(string pool, address newAddress);

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    /// @param _usdt            USDT token address
    /// @param _claimRewards    ClaimRewards contract address
    /// @param _periodicRewards PeriodicRewards contract address
    /// @param _luckyDraw       LuckyDraw contract address
    /// @param _incentivePool   IncentivePool contract address
    /// @param _admin           DEFAULT_ADMIN_ROLE holder (DAOGovernor)
    constructor(
        address _usdt,
        address _claimRewards,
        address _periodicRewards,
        address _luckyDraw,
        address _incentivePool,
        address _admin
    ) {
        require(_usdt           != address(0), "RewardDistributor: zero address");
        require(_claimRewards   != address(0), "RewardDistributor: zero address");
        require(_periodicRewards != address(0), "RewardDistributor: zero address");
        require(_luckyDraw      != address(0), "RewardDistributor: zero address");
        require(_incentivePool  != address(0), "RewardDistributor: zero address");
        require(_admin          != address(0), "RewardDistributor: zero address");

        usdt           = IERC20(_usdt);
        claimRewards   = _claimRewards;
        periodicRewards = _periodicRewards;
        luckyDraw      = _luckyDraw;
        incentivePool  = _incentivePool;

        // Default BPS allocation (must sum to 10000)
        bpsClaim    = 6857; // Referral 10% + Community Builder 5% + GV 9% = 24% of 35%
        bpsPeriodic = 2143; // Monthly NFT Pool 7.5% of 35%
        bpsLucky    = 286;  // Lucky Draw 1% of 35%
        bpsIncentive = 714; // Incentives 2.5% of 35% (absorbs rounding dust)

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ─────────────────────────────────────────────────────────
    // Core Distribution
    // ─────────────────────────────────────────────────────────

    /// @notice Called by RevenueRouter (DISTRIBUTOR_ROLE) to split the 35% marketing portion.
    ///         Pulls `amount` USDT from caller and distributes to 4 sub-contracts.
    ///         IncentivePool receives the remainder to eliminate rounding dust.
    /// @param  amount  USDT amount (6 decimals) to distribute
    function receiveAndDistribute(uint256 amount) external nonReentrant onlyRole(DISTRIBUTOR_ROLE) {
        require(amount > 0, "RewardDistributor: zero amount");

        // Pull USDT from caller (caller must have approved this contract)
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        // Calculate splits — last pool (incentivePool) absorbs any rounding dust
        uint256 toClaim    = (amount * bpsClaim)    / BPS_TOTAL;
        uint256 toPeriodic = (amount * bpsPeriodic) / BPS_TOTAL;
        uint256 toLucky    = (amount * bpsLucky)    / BPS_TOTAL;
        uint256 toIncentive = amount - toClaim - toPeriodic - toLucky;

        // Distribute to all 4 sub-contracts
        if (toClaim    > 0) usdt.safeTransfer(claimRewards,    toClaim);
        if (toPeriodic > 0) usdt.safeTransfer(periodicRewards, toPeriodic);
        if (toLucky    > 0) usdt.safeTransfer(luckyDraw,       toLucky);
        if (toIncentive > 0) usdt.safeTransfer(incentivePool,  toIncentive);

        emit RewardDistributed(msg.sender, amount);
    }

    // ─────────────────────────────────────────────────────────
    // DAO BPS Adjustment
    // ─────────────────────────────────────────────────────────

    /// @notice DAO-governed BPS adjustment.
    ///         Each pool may change by at most ±200 BPS per call.
    ///         14-day cooldown enforced between adjustments.
    ///         New values must sum to exactly 10000.
    /// @param  newClaim    New BPS for ClaimRewards
    /// @param  newPeriodic New BPS for PeriodicRewards
    /// @param  newLucky    New BPS for LuckyDraw
    /// @param  newIncentive New BPS for IncentivePool
    function adjustBPS(
        uint256 newClaim,
        uint256 newPeriodic,
        uint256 newLucky,
        uint256 newIncentive
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Cooldown check
        require(
            block.timestamp >= lastAdjustmentTime + BPS_ADJUSTMENT_COOLDOWN,
            "RewardDistributor: cooldown active"
        );

        // Total must equal 10000
        require(
            newClaim + newPeriodic + newLucky + newIncentive == BPS_TOTAL,
            "RewardDistributor: total BPS must be 10000"
        );

        // Each pool must not change by more than MAX_BPS_CHANGE
        _checkBPSChange(bpsClaim,    newClaim);
        _checkBPSChange(bpsPeriodic, newPeriodic);
        _checkBPSChange(bpsLucky,    newLucky);
        _checkBPSChange(bpsIncentive, newIncentive);

        bpsClaim    = newClaim;
        bpsPeriodic = newPeriodic;
        bpsLucky    = newLucky;
        bpsIncentive = newIncentive;

        lastAdjustmentTime = block.timestamp;

        emit BPSAdjusted(newClaim, newPeriodic, newLucky, newIncentive);
    }

    /// @dev Reverts if the absolute difference between old and new BPS exceeds MAX_BPS_CHANGE.
    function _checkBPSChange(uint256 oldVal, uint256 newVal) private pure {
        uint256 diff = oldVal > newVal ? oldVal - newVal : newVal - oldVal;
        require(diff <= MAX_BPS_CHANGE, "RewardDistributor: BPS change too large");
    }

    // ─────────────────────────────────────────────────────────
    // Admin — Recipient Address Setters
    // ─────────────────────────────────────────────────────────

    /// @notice Update the ClaimRewards recipient
    function setClaimRewards(address newAddr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddr != address(0), "RewardDistributor: zero address");
        claimRewards = newAddr;
        emit RecipientUpdated("claimRewards", newAddr);
    }

    /// @notice Update the PeriodicRewards recipient
    function setPeriodicRewards(address newAddr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddr != address(0), "RewardDistributor: zero address");
        periodicRewards = newAddr;
        emit RecipientUpdated("periodicRewards", newAddr);
    }

    /// @notice Update the LuckyDraw recipient
    function setLuckyDraw(address newAddr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddr != address(0), "RewardDistributor: zero address");
        luckyDraw = newAddr;
        emit RecipientUpdated("luckyDraw", newAddr);
    }

    /// @notice Update the IncentivePool recipient
    function setIncentivePool(address newAddr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddr != address(0), "RewardDistributor: zero address");
        incentivePool = newAddr;
        emit RecipientUpdated("incentivePool", newAddr);
    }
}
