// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PeriodicRewards — Monthly NFT Pool 7.5%
/// @notice Receives 21.43% (2143 BPS) of the marketing pool from RewardDistributor.
///         Distributes the Monthly NFT Pool (100% of received) to NFT holders.
///         Admin triggers distributions off-chain to pre-computed recipient lists.
///
/// ### Monthly Pool (5-tier allocation)
///   Tier 1: 10%, Tier 2: 18%, Tier 3: 22%, Tier 4: 25%, Tier 5: 25%
///   Admin calls distributeMonthly(recipients, amounts).
contract PeriodicRewards is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────

    /// @notice Granted to RewardDistributor — the only caller of receiveUSDT().
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // ─────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────

    uint256 public constant BPS_MONTHLY = 10_000; // 100% of received → corresponds to 7.5% of net revenue

    // ─────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────

    /// @notice USDT token (6 decimals on BSC)
    IERC20 public immutable usdt;

    /// @notice Accumulated USDT available for monthly pool distribution
    uint256 private _monthlyBalance;

    // ─────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────

    /// @notice Emitted when USDT is received for the monthly pool
    event USDTReceived(uint256 total, uint256 toMonthly);

    /// @notice Emitted when admin distributes the monthly pool
    event MonthlyDistributed(uint256 totalDistributed);

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    /// @param _usdt   USDT token address
    /// @param _admin  DEFAULT_ADMIN_ROLE holder (DAOGovernor / deployer)
    constructor(address _usdt, address _admin) {
        require(_usdt  != address(0), "PeriodicRewards: zero address");
        require(_admin != address(0), "PeriodicRewards: zero address");

        usdt = IERC20(_usdt);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ─────────────────────────────────────────────────────────
    // Funding
    // ─────────────────────────────────────────────────────────

    /// @notice Called by RewardDistributor to fund the monthly pool.
    ///         Pulls `amount` USDT from caller (caller must have approved).
    /// @param amount USDT amount (6 decimals) to receive
    function receiveUSDT(uint256 amount) external nonReentrant onlyRole(DISTRIBUTOR_ROLE) {
        require(amount > 0, "PeriodicRewards: zero amount");

        usdt.safeTransferFrom(msg.sender, address(this), amount);

        _monthlyBalance += amount;

        emit USDTReceived(amount, amount);
    }

    // ─────────────────────────────────────────────────────────
    // Admin — Monthly Distribution
    // ─────────────────────────────────────────────────────────

    /// @notice Admin distributes the monthly pool to a list of recipients.
    ///         Off-chain logic assigns 5-tier amounts (10/18/22/25/25%)
    ///         based on monthly sales volume rankings.
    ///         Total of `amounts` must not exceed current `monthlyBalance()`.
    /// @param recipients Array of recipient addresses
    /// @param amounts    Array of USDT amounts corresponding to each recipient
    function distributeMonthly(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        require(recipients.length > 0, "PeriodicRewards: empty arrays");
        require(recipients.length == amounts.length, "PeriodicRewards: length mismatch");

        uint256 total = _sumAmounts(amounts);
        require(total <= _monthlyBalance, "PeriodicRewards: insufficient monthly balance");

        _monthlyBalance -= total;

        for (uint256 i = 0; i < recipients.length; i++) {
            if (amounts[i] > 0) {
                usdt.safeTransfer(recipients[i], amounts[i]);
            }
        }

        emit MonthlyDistributed(total);
    }

    // ─────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────

    /// @notice Returns the current accumulated USDT in the monthly pool
    function monthlyBalance() external view returns (uint256) {
        return _monthlyBalance;
    }

    // ─────────────────────────────────────────────────────────
    // Internal Helpers
    // ─────────────────────────────────────────────────────────

    /// @dev Sums an array of uint256 values.
    function _sumAmounts(uint256[] calldata amounts) private pure returns (uint256 total) {
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
    }
}
