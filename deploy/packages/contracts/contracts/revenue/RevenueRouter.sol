// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev RewardDistributorV2 is funded via approve + receiveAndDistribute (pull).
interface IRewardDistributorV2 {
    function receiveAndDistribute(uint256 amount) external;
}

/// @dev Infra pools (ManagementPool/TreasuryManager/ListingReserve/LiquidityPool) split
///      internally on receiveUSDT — they MUST be called (not just pushed to).
interface IUSDTReceiver {
    function receiveUSDT(uint256 amount) external;
}

/// @title RevenueRouter — Central 6-way GROSS USDT Splitter (revised 2026-07)
/// @notice Receives the FULL gross USDT from PreSale / MICELicense and splits it across
///         6 destinations. ALL percentages are of GROSS (100% input):
///           Referral  10%  → ReferralRegistry (F1 7% + F2 3%; unspent → Milestones & Incentives)
///           Marketing 25%  → RewardDistributorV2
///           Management 7.5%
///           Treasury  12.5%
///           Staking    5%
///           Liquidity 40%
///         Referral is FIXED at 10% (F1/F2 immutable). The other 5 buckets are DAO-adjustable
///         (±500 BPS / change, 30-day cooldown) and must sum to 9000 (10000 − referral 1000).
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

    /// @notice ReferralRegistry — receives the Referral 10% slice (F1/F2 + overflow)
    address public referral;

    /// @notice RewardDistributorV2 contract — receives Marketing & Sales portion
    address public marketing;

    /// @notice ManagementPool contract — receives Management & Operational portion
    address public management;

    /// @notice TreasuryManager contract — receives DAO Treasury portion
    address public treasury;

    /// @notice ListingReserve — receives the 5% Listing & External Market slice.
    ///         This wallet auto-buys MIC from DEX and deposits via LiquidityPool.depositMIC()
    address public reservedStaking;

    /// @notice LiquidityPool contract — receives Liquidity Pool & Buffer portion
    address public liquidity;

    // ─────────────────────────────────────────────────────────
    // State — BPS weights (out of 10000)
    // ─────────────────────────────────────────────────────────

    // All BPS are of GROSS (100% input). Referral is FIXED (constant below). The 5 below are
    // DAO-adjustable and MUST sum to BPS_ADJUSTABLE_TOTAL (9000).
    uint256 public bpsMarketing;   // Default 2500 = 25%   of gross → RewardDistributorV2
    uint256 public bpsManagement;  // Default  750 = 7.5%  of gross
    uint256 public bpsTreasury;    // Default 1250 = 12.5% of gross
    uint256 public bpsStaking;     // Default  500 = 5%    of gross
    uint256 public bpsLiquidity;   // Default 4000 = 40%   of gross (absorbs rounding dust)

    /// @notice Referral slice — FIXED at 10% of gross (F1 7% + F2 3%, immutable per spec).
    uint256 public constant BPS_REFERRAL = 1000;
    /// @notice The 5 adjustable buckets must always sum to this (10000 − referral 1000).
    uint256 public constant BPS_ADJUSTABLE_TOTAL = 9000;

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
    event TokenRescued(address indexed token, address indexed to, uint256 amount);
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
    /// @param _referral        ReferralRegistry address (receives Referral 10% slice)
    /// @param _marketing       RewardDistributorV2 address
    /// @param _management      ManagementPool address
    /// @param _treasury        TreasuryManager address
    /// @param _reservedStaking ListingReserve contract (5% slice)
    /// @param _liquidity       LiquidityPool address
    /// @param _admin           DEFAULT_ADMIN_ROLE holder (DAOGovernor)
    constructor(
        address _usdt,
        address _referral,
        address _marketing,
        address _management,
        address _treasury,
        address _reservedStaking,
        address _liquidity,
        address _admin
    ) {
        require(_usdt           != address(0), "RevenueRouter: zero address");
        require(_referral       != address(0), "RevenueRouter: zero address");
        require(_marketing      != address(0), "RevenueRouter: zero address");
        require(_management     != address(0), "RevenueRouter: zero address");
        require(_treasury       != address(0), "RevenueRouter: zero address");
        require(_reservedStaking != address(0), "RevenueRouter: zero address");
        require(_liquidity      != address(0), "RevenueRouter: zero address");
        require(_admin          != address(0), "RevenueRouter: zero address");

        usdt            = IERC20(_usdt);
        referral        = _referral;
        marketing       = _marketing;
        management      = _management;
        treasury        = _treasury;
        reservedStaking = _reservedStaking;
        liquidity       = _liquidity;

        // Default BPS of GROSS. The 5 adjustable buckets sum to 9000 (+ referral 1000 = 10000).
        bpsMarketing  = 2500; // 25%
        bpsManagement = 750;  // 7.5%
        bpsTreasury   = 1250; // 12.5%
        bpsStaking    = 500;  // 5%
        bpsLiquidity  = 4000; // 40%

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ─────────────────────────────────────────────────────────
    // Core Distribution
    // ─────────────────────────────────────────────────────────

    /// @notice Called by authorized sale contracts (PreSale, MICELicense) with the FULL GROSS
    ///         amount. Splits it 6 ways (all % of gross). Referral 10% is pushed to the
    ///         ReferralRegistry (the sale contract then triggers per-buyer F1/F2 payout);
    ///         Marketing is pulled by RewardDistributorV2 (approve + receiveAndDistribute).
    /// @param  amount  GROSS USDT amount (6 decimals)
    function receiveAndDistribute(uint256 amount) external nonReentrant onlyRole(DISTRIBUTOR_ROLE) {
        require(amount > 0, "RevenueRouter: zero amount");

        // Pull GROSS USDT from caller (caller must have approved this contract)
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        // Calculate splits — liquidity absorbs any rounding dust
        uint256 toReferral   = (amount * BPS_REFERRAL)  / BPS_TOTAL;
        uint256 toMarketing  = (amount * bpsMarketing)  / BPS_TOTAL;
        uint256 toManagement = (amount * bpsManagement) / BPS_TOTAL;
        uint256 toTreasury   = (amount * bpsTreasury)   / BPS_TOTAL;
        uint256 toStaking    = (amount * bpsStaking)    / BPS_TOTAL;
        uint256 toLiquidity  = amount - toReferral - toMarketing - toManagement - toTreasury - toStaking;

        // Referral slice → ReferralRegistry (push; sale contract pays F1/F2 from it per-buyer)
        if (toReferral > 0) usdt.safeTransfer(referral, toReferral);
        // Marketing → RewardDistributorV2 (pull pattern)
        if (toMarketing > 0) {
            usdt.forceApprove(marketing, toMarketing);
            IRewardDistributorV2(marketing).receiveAndDistribute(toMarketing);
        }
        // Infra pools split internally on receiveUSDT → must approve + call (not push)
        _fundPool(management,      toManagement);
        _fundPool(treasury,        toTreasury);
        _fundPool(reservedStaking, toStaking);
        _fundPool(liquidity,       toLiquidity);

        emit RevenueDistributed(msg.sender, amount);
    }

    function _fundPool(address pool, uint256 amt) private {
        if (amt == 0) return;
        usdt.forceApprove(pool, amt);
        IUSDTReceiver(pool).receiveUSDT(amt);
    }

    // ─────────────────────────────────────────────────────────
    // DAO BPS Adjustment
    // ─────────────────────────────────────────────────────────

    /// @notice DAO-governed BPS adjustment for the 5 adjustable buckets (referral is fixed).
    ///         Each pool may change by at most ±500 BPS per call.
    ///         30-day cooldown enforced between adjustments.
    ///         New values must sum to exactly 9000 (referral 1000 is fixed).
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

        // The 5 adjustable buckets must sum to 9000 (referral 1000 is fixed → total 10000)
        require(
            newMarketing + newManagement + newTreasury + newStaking + newLiquidity == BPS_ADJUSTABLE_TOTAL,
            "RevenueRouter: adjustable BPS must be 9000"
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

    /// @notice Recover ERC-20 tokens sent here by mistake.
    /// @dev A contract that can hold a token must be able to send it. `TreasuryManager`
    ///      v1 could not, and 105,000,000 MIC is stranded there permanently as a result.
    ///      These contracts are not upgradeable, so this cannot be added later.
    ///      receiveAndDistribute splits and forwards in the same call, so nothing rests here by
    ///      design. Any resting balance is a stray deposit and may be recovered in full.
    function rescueToken(address token, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant
    {
        require(to != address(0), "REV: zero recipient");
        require(amount > 0,       "REV: zero amount");
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }
}
