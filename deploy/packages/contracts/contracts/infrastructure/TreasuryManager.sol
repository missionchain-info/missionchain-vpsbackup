// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TreasuryManager — DAO Treasury receiving 12.5% from RevenueRouter
/// @notice Manages DAO Treasury funds split into 3 sub-pools:
///         - World Dev:  20% of treasury (2.5/12.5)
///         - App Add-Ons: 40% of treasury (5.0/12.5)
///         - Reserved:   40% of treasury (5.0/12.5)
/// @dev Receives USDT via receiveUSDT() from RevenueRouter (DISTRIBUTOR_ROLE).
///      Transfer limits: max 5% of sub-pool balance per tx, max 2 per 30-day period.
///      Emergency withdraw: DAOGovernor only (DAO_ROLE), bypasses all limits.
contract TreasuryManager is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ───
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 public constant DAO_ROLE         = keccak256("DAO_ROLE");

    // ─── Governance Constraints ───
    uint256 public constant MAX_TRANSFER_BPS     = 500;  // 5% max per transfer
    uint256 public constant MAX_TRANSFERS_PER_PERIOD = 2;
    uint256 public constant PERIOD_DURATION      = 30 days;

    // ─── Sub-pool Indices ───
    uint256 public constant POOL_WORLD_DEV  = 0;
    uint256 public constant POOL_APP_ADDONS = 1;
    uint256 public constant POOL_RESERVED   = 2;

    // Sub-pool BPS (out of 10000, relative to total treasury received)
    // World Dev:  2.5/12.5 = 20% → 2000 BPS
    // App Add-Ons: 5.0/12.5 = 40% → 4000 BPS
    // Reserved:   5.0/12.5 = 40% → 4000 BPS
    uint256 private constant BPS_WORLD_DEV  = 2000;
    uint256 private constant BPS_APP_ADDONS = 4000;
    uint256 private constant BPS_RESERVED   = 4000;

    // ─── State ───
    IERC20 public immutable usdt;

    /// @notice Balances of each sub-pool (tracked internally)
    uint256[3] public subPoolBalance;

    /// @notice Total USDT received
    uint256 public totalReceived;

    /// @notice Transfer period tracking per sub-pool: subPoolIndex → period index → count
    /// Period index = block.timestamp / PERIOD_DURATION
    mapping(uint256 => mapping(uint256 => uint256)) public periodTransferCount;

    // ─── Events ───
    event USDTReceived(uint256 amount, uint256 worldDev, uint256 appAddOns, uint256 reserved);
    event Transfer(uint256 indexed subPool, address indexed to, uint256 amount);
    event EmergencyWithdraw(uint256 indexed subPool, address indexed to, uint256 amount);

    // ─── Constructor ───

    /// @param _usdt USDT token address
    /// @param _admin DEFAULT_ADMIN_ROLE holder (DAOGovernor or deployer initially)
    constructor(address _usdt, address _admin) {
        require(_usdt != address(0),  "TreasuryManager: zero usdt");
        require(_admin != address(0), "TreasuryManager: zero admin");

        usdt = IERC20(_usdt);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ─── Core Functions ───

    /// @notice Receive USDT from RevenueRouter and split into 3 sub-pools
    /// @dev Caller must have DISTRIBUTOR_ROLE and must have approved this contract
    /// @param amount Total USDT amount to receive (12.5% of net revenue)
    function receiveUSDT(uint256 amount) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        require(amount > 0, "TreasuryManager: zero amount");

        usdt.safeTransferFrom(msg.sender, address(this), amount);

        uint256 worldDev  = (amount * BPS_WORLD_DEV)  / 10000;
        uint256 appAddOns = (amount * BPS_APP_ADDONS) / 10000;
        // Remaining to reserved (handles rounding dust)
        uint256 reserved  = amount - worldDev - appAddOns;

        subPoolBalance[POOL_WORLD_DEV]  += worldDev;
        subPoolBalance[POOL_APP_ADDONS] += appAddOns;
        subPoolBalance[POOL_RESERVED]   += reserved;

        totalReceived += amount;

        emit USDTReceived(amount, worldDev, appAddOns, reserved);
    }

    /// @notice Transfer USDT from a sub-pool to an address
    /// @dev Subject to governance constraints: max 5% per tx, max 2 per 30-day period
    /// @param subPool Sub-pool index (0=World Dev, 1=App Add-Ons, 2=Reserved)
    /// @param to Recipient address
    /// @param amount Amount to transfer
    function transfer(
        uint256 subPool,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(subPool <= POOL_RESERVED, "TreasuryManager: invalid pool");
        require(to != address(0),         "TreasuryManager: zero recipient");
        require(amount > 0,               "TreasuryManager: zero amount");

        uint256 balance = subPoolBalance[subPool];
        require(balance > 0, "TreasuryManager: pool empty");

        // Constraint 1: max 5% of sub-pool balance per transfer
        uint256 maxAmount = (balance * MAX_TRANSFER_BPS) / 10000;
        require(amount <= maxAmount, "TreasuryManager: exceeds 5% limit");

        // Constraint 2: max 2 transfers per 30-day period per sub-pool
        uint256 periodIndex = block.timestamp / PERIOD_DURATION;
        require(
            periodTransferCount[subPool][periodIndex] < MAX_TRANSFERS_PER_PERIOD,
            "TreasuryManager: monthly limit reached"
        );
        periodTransferCount[subPool][periodIndex]++;

        subPoolBalance[subPool] -= amount;
        usdt.safeTransfer(to, amount);

        emit Transfer(subPool, to, amount);
    }

    /// @notice Emergency withdraw from a sub-pool (bypasses all limits)
    /// @dev DAO_ROLE only (DAOGovernor emergency path)
    /// @param subPool Sub-pool index (0=World Dev, 1=App Add-Ons, 2=Reserved)
    /// @param to Recipient address
    /// @param amount Amount to withdraw
    function emergencyWithdraw(
        uint256 subPool,
        address to,
        uint256 amount
    ) external onlyRole(DAO_ROLE) nonReentrant {
        require(subPool <= POOL_RESERVED, "TreasuryManager: invalid pool");
        require(to != address(0),         "TreasuryManager: zero recipient");
        require(amount > 0,               "TreasuryManager: zero amount");
        require(subPoolBalance[subPool] >= amount, "TreasuryManager: insufficient balance");

        subPoolBalance[subPool] -= amount;
        usdt.safeTransfer(to, amount);

        emit EmergencyWithdraw(subPool, to, amount);
    }

    // ─── View Functions ───

    /// @notice Get balance of a specific sub-pool
    function getSubPoolBalance(uint256 subPool) external view returns (uint256) {
        require(subPool <= POOL_RESERVED, "TreasuryManager: invalid pool");
        return subPoolBalance[subPool];
    }

    /// @notice Get transfer count for a sub-pool in the current 30-day period
    function getCurrentPeriodTransfers(uint256 subPool) external view returns (uint256) {
        require(subPool <= POOL_RESERVED, "TreasuryManager: invalid pool");
        uint256 periodIndex = block.timestamp / PERIOD_DURATION;
        return periodTransferCount[subPool][periodIndex];
    }

    /// @notice Get the total USDT balance held by this contract
    function getContractBalance() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }
}
