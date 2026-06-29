// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RevenueRouter — Central 35/7.5/12.5/5/40 USDT Splitter
/// @notice Receives USDT from PreSale and MICELicense (after referral deduction)
///         and distributes it across 5 pools according to BPS weights.
///         BPS values are DAO-adjustable with ±500 BPS per change and 30-day cooldown.
contract RevenueRouter is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────

    /// @notice Only addresses with this role may call receiveAndDistribute().
    /// Granted to authorized sale contracts (PreSale, MICELicense).
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // ─────────────────────────────────────────────────────────
    // State — token
    // ─────────────────────────────────────────────────────────

    /// @notice USDT token address (6 decimals on BSC)
    IERC20 public immutable usdt;

    // ─────────────────────────────────────────────────────────
    // State — recipients
    // ─────────────────────────────────────────────────────────

    /// @notice RewardDistributor contract — receives Marketing & Sales portion
    address public marketing;

    /// @notice ManagementPool contract — receives Management & Operational portion
    address public management;

    /// @notice TreasuryManager contract — receives DAO Treasury portion
    address public treasury;

    /// @notice Admin wallet — receives Reserved Staking portion.
    ///         This wallet auto-buys MIC from DEX and deposits via LiquidityPool.depositMIC()
    address public reservedStaking;

    /// @notice LiquidityPool contract — receives Liquidity Pool & Buffer portion
    address public liquidity;

    // ─────────────────────────────────────────────────────────
    // State — BPS weights (out of 10000)
    // ─────────────────────────────────────────────────────────

    uint256 public bpsMarketing;   // Default 3500 = 35%
    uint256 public bpsManagement;  // Default  750 = 7.5%
    uint256 public bpsTreasury;    // Default 1250 = 12.5%
    uint256 public bpsStaking;     // Default  500 = 5%
    uint256 public bpsLiquidity;   // Default 4000 = 40%

    // ─────────────────────────────────────────────────────────
    // State — cooldown
    // ─────────────────────────────────────────────────────────

    uint256 public constant BPS_ADJUSTMENT_COOLDOWN = 30 days;
    uint256 public constant MAX_BPS_CHANGE          = 500;  // ±5% per adjustment
    uint256 public constant BPS_TOTAL               = 10_000;

    /// @notice Timestamp of the last BPS adjustment (0 = never adjusted)
    uint256 public lastAdjustmentTime;

    // ─────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────

    /// @notice Emitted whenever revenue is distributed across the 5 pools
    event RevenueDistributed(address indexed caller, uint256 totalAmount);

    /// @notice Emitted when BPS weights are adjusted by DAO
    event BPSAdjusted(
        uint256 marketing,
        uint256 management,
        uint256 treasury,
        uint256 staking,
        uint256 liquidity
    );

    /// @notice Emitted when a recipient address is updated
    event RecipientUpdated(string pool, address newAddress);

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    /// @param _usdt            USDT token address
    /// @param _marketing       RewardDistributor address
    /// @param _management      ManagementPool address
    /// @param _treasury        TreasuryManager address
    /// @param _reservedStaking Admin wallet for reserved staking auto-buys
    /// @param _liquidity       LiquidityPool address
    /// @param _admin           DEFAULT_ADMIN_ROLE holder (DAOGovernor)
    constructor(
        address _usdt,
        address _marketing,
        address _management,
        address _treasury,
        address _reservedStaking,
        address _liquidity,
        address _admin
    ) {
        require(_usdt           != address(0), "RevenueRouter: zero address");
        require(_marketing      != address(0), "RevenueRouter: zero address");
        require(_management     != address(0), "RevenueRouter: zero address");
        require(_treasury       != address(0), "RevenueRouter: zero address");
        require(_reservedStaking != address(0), "RevenueRouter: zero address");
        require(_liquidity      != address(0), "RevenueRouter: zero address");
        require(_admin          != address(0), "RevenueRouter: zero address");

        usdt            = IERC20(_usdt);
        marketing       = _marketing;
        management      = _management;
        treasury        = _treasury;
        reservedStaking = _reservedStaking;
        liquidity       = _liquidity;

        // Default BPS allocation (must sum to 10000)
        bpsMarketing  = 3500; // 35%
        bpsManagement = 750;  // 7.5%
        bpsTreasury   = 1250; // 12.5%
        bpsStaking    = 500;  // 5%
        bpsLiquidity  = 4000; // 40%

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ─────────────────────────────────────────────────────────
    // Core Distribution
    // ─────────────────────────────────────────────────────────

    /// @notice Called by authorized sale contracts (PreSale, MICELicense) after
    ///         referral deduction. Pulls `amount` USDT from caller and splits across 5 pools.
    /// @param  amount  USDT amount (6 decimals) to distribute
    function receiveAndDistribute(uint256 amount) external nonReentrant onlyRole(DISTRIBUTOR_ROLE) {
        require(amount > 0, "RevenueRouter: zero amount");

        // Pull USDT from caller (caller must have approved this contract)
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        // Calculate splits — last pool (liquidity) absorbs any rounding dust
        uint256 toMarketing  = (amount * bpsMarketing)  / BPS_TOTAL;
        uint256 toManagement = (amount * bpsManagement) / BPS_TOTAL;
        uint256 toTreasury   = (amount * bpsTreasury)   / BPS_TOTAL;
        uint256 toStaking    = (amount * bpsStaking)    / BPS_TOTAL;
        uint256 toLiquidity  = amount - toMarketing - toManagement - toTreasury - toStaking;

        // Distribute
        if (toMarketing > 0)  usdt.safeTransfer(marketing,       toMarketing);
        if (toManagement > 0) usdt.safeTransfer(management,      toManagement);
        if (toTreasury > 0)   usdt.safeTransfer(treasury,        toTreasury);
        if (toStaking > 0)    usdt.safeTransfer(reservedStaking,  toStaking);
        if (toLiquidity > 0)  usdt.safeTransfer(liquidity,        toLiquidity);

        emit RevenueDistributed(msg.sender, amount);
    }

    // ─────────────────────────────────────────────────────────
    // DAO BPS Adjustment
    // ─────────────────────────────────────────────────────────

    /// @notice DAO-governed BPS adjustment.
    ///         Each pool may change by at most ±500 BPS per call.
    ///         30-day cooldown enforced between adjustments.
    ///         New values must sum to exactly 10000.
    /// @param  newMarketing   New BPS for Marketing & Sales
    /// @param  newManagement  New BPS for Management & Operational
    /// @param  newTreasury    New BPS for DAO Treasury
    /// @param  newStaking     New BPS for Reserved Staking
    /// @param  newLiquidity   New BPS for Liquidity Pool & Buffer
    function adjustBPS(
        uint256 newMarketing,
        uint256 newManagement,
        uint256 newTreasury,
        uint256 newStaking,
        uint256 newLiquidity
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Cooldown check
        require(
            block.timestamp >= lastAdjustmentTime + BPS_ADJUSTMENT_COOLDOWN,
            "RevenueRouter: cooldown active"
        );

        // Total must equal 10000
        require(
            newMarketing + newManagement + newTreasury + newStaking + newLiquidity == BPS_TOTAL,
            "RevenueRouter: total BPS must be 10000"
        );

        // Each pool must not change by more than MAX_BPS_CHANGE
        _checkBPSChange(bpsMarketing,  newMarketing);
        _checkBPSChange(bpsManagement, newManagement);
        _checkBPSChange(bpsTreasury,   newTreasury);
        _checkBPSChange(bpsStaking,    newStaking);
        _checkBPSChange(bpsLiquidity,  newLiquidity);

        bpsMarketing  = newMarketing;
        bpsManagement = newManagement;
        bpsTreasury   = newTreasury;
        bpsStaking    = newStaking;
        bpsLiquidity  = newLiquidity;

        lastAdjustmentTime = block.timestamp;

        emit BPSAdjusted(newMarketing, newManagement, newTreasury, newStaking, newLiquidity);
    }

    /// @dev Reverts if the absolute difference between old and new BPS exceeds MAX_BPS_CHANGE.
    function _checkBPSChange(uint256 oldVal, uint256 newVal) private pure {
        uint256 diff = oldVal > newVal ? oldVal - newVal : newVal - oldVal;
        require(diff <= MAX_BPS_CHANGE, "RevenueRouter: BPS change too large");
    }

    // ─────────────────────────────────────────────────────────
    // Admin — Recipient Address Setters
    // ─────────────────────────────────────────────────────────

    /// @notice Update the Marketing & Sales recipient (RewardDistributor)
    function setMarketing(address newAddr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddr != address(0), "RevenueRouter: zero address");
        marketing = newAddr;
        emit RecipientUpdated("marketing", newAddr);
    }

    /// @notice Update the Management & Operational recipient (ManagementPool)
    function setManagement(address newAddr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddr != address(0), "RevenueRouter: zero address");
        management = newAddr;
        emit RecipientUpdated("management", newAddr);
    }

    /// @notice Update the DAO Treasury recipient (TreasuryManager)
    function setTreasury(address newAddr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddr != address(0), "RevenueRouter: zero address");
        treasury = newAddr;
        emit RecipientUpdated("treasury", newAddr);
    }

    /// @notice Update the Reserved Staking recipient (admin wallet)
    function setReservedStaking(address newAddr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddr != address(0), "RevenueRouter: zero address");
        reservedStaking = newAddr;
        emit RecipientUpdated("reservedStaking", newAddr);
    }

    /// @notice Update the Liquidity Pool & Buffer recipient (LiquidityPool)
    function setLiquidity(address newAddr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddr != address(0), "RevenueRouter: zero address");
        liquidity = newAddr;
        emit RecipientUpdated("liquidity", newAddr);
    }
}
