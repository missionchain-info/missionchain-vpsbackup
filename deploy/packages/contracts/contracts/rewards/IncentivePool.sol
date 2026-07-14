// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title IncentivePool — DAO-Governed Incentive Fund
/// @notice Receives 7.14% (714 BPS) of the marketing pool from RewardDistributor.
///         This corresponds to 2.5% of net revenue (both Pre-Sale and MICE).
///
///         The DAO (admin) decides when and to whom to distribute — no automated logic.
///         All distributions are made via the `distribute()` function by DEFAULT_ADMIN_ROLE.
contract IncentivePool is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────

    /// @notice Role granted to RewardDistributor — allows calling receiveUSDT().
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // ─────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────

    /// @notice USDT token (6 decimals on BSC)
    IERC20 public immutable usdt;

    // ─────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────

    /// @notice Emitted when USDT is received from RewardDistributor
    event USDTReceived(uint256 amount);

    /// @notice Emitted when admin distributes USDT to recipients
    /// @param recipientCount Number of recipients in this distribution
    /// @param totalAmount    Total USDT distributed
    event Distributed(uint256 recipientCount, uint256 totalAmount);

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    /// @param _usdt  USDT token address (6 decimals)
    /// @param _admin DEFAULT_ADMIN_ROLE holder (DAOGovernor)
    constructor(address _usdt, address _admin) {
        require(_usdt  != address(0), "IncentivePool: zero address");
        require(_admin != address(0), "IncentivePool: zero address");

        usdt = IERC20(_usdt);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ─────────────────────────────────────────────────────────
    // Receive
    // ─────────────────────────────────────────────────────────

    /// @notice Called by RewardDistributor (DISTRIBUTOR_ROLE).
    ///         Pulls `amount` USDT from caller and accumulates in this contract.
    /// @param  amount  USDT amount (6 decimals) to accumulate
    function receiveUSDT(uint256 amount) external nonReentrant onlyRole(DISTRIBUTOR_ROLE) {
        require(amount > 0, "IncentivePool: zero amount");

        usdt.safeTransferFrom(msg.sender, address(this), amount);

        emit USDTReceived(amount);
    }

    // ─────────────────────────────────────────────────────────
    // Distribute
    // ─────────────────────────────────────────────────────────

    /// @notice DAO distributes accumulated USDT to any set of addresses.
    ///         No automated logic — purely admin-driven (DAOGovernor proposal or direct call).
    /// @param  recipients  Array of recipient addresses
    /// @param  amounts     USDT amounts (6 decimals) for each recipient
    function distribute(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        require(recipients.length > 0, "IncentivePool: empty arrays");
        require(recipients.length == amounts.length, "IncentivePool: length mismatch");

        // Sum all amounts and check against balance in a single pass
        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
        require(total <= currentBalance(), "IncentivePool: insufficient balance");

        // Transfer to each recipient
        for (uint256 i = 0; i < recipients.length; i++) {
            if (amounts[i] > 0) {
                usdt.safeTransfer(recipients[i], amounts[i]);
            }
        }

        emit Distributed(recipients.length, total);
    }

    // ─────────────────────────────────────────────────────────
    // View
    // ─────────────────────────────────────────────────────────

    /// @notice Current USDT balance held by this contract (6 decimals)
    function currentBalance() public view returns (uint256) {
        return usdt.balanceOf(address(this));
    }
}
