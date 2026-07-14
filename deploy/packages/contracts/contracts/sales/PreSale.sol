// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/ILockManager.sol";

/// @dev Minimal interface for CommunityNFT.mint()
interface ICommunityNFT {
    function mint(address to, uint256 tier) external returns (uint256);
}

/// @dev Minimal interface for ReferralRegistry.distributeReferral()
interface IReferralRegistry {
    function referrerOf(address user) external view returns (address);
    function distributeReferral(address buyer, uint256 usdtAmount) external;
}

/// @dev Minimal interface for RevenueRouter.receiveAndDistribute()
interface IRevenueRouter {
    function receiveAndDistribute(uint256 amount) external;
}

/// @title PreSale — Community Pre-Sale at $0.005/MIC, WITH referral & NFT packages
/// @notice 4.50% of total supply = 315,000,000 MIC allocated.
///         3 optional packages bundle CommunityNFTs (Builder/Maker/Luminary).
///         Minimum purchase: $25 USDT (no package needed).
///         MIC transferred directly to buyer wallet (Hybrid Token-Level Lock).
///         LockManager.createSchedule(): 6-month cliff, 10% unlock, 2.5%/month.
///         F1: 7% USDT / F2: 3% USDT — paid via ReferralRegistry.
///         Net USDT (90% if referral, 100% if no referrer) → RevenueRouter.
contract PreSale is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Total MIC allocation for Pre-Sale (4.50% of 7B = 315M MIC)
    uint256 public constant ALLOCATION = 315_000_000 ether;

    /// @notice Hard cap in USDT (6 decimals): 315M MIC × $0.005 = $1,575,000
    uint256 public constant HARD_CAP = 1_575_000e6;

    /// @notice MIC price: 1 USDT (6-dec) = 200 MIC (18-dec)
    ///         Conversion: micAmount = usdtAmount * 200 * 1e12
    uint256 private constant MIC_PER_USDT = 200;

    /// @notice Minimum purchase amount in USDT (6 decimals): $25
    uint256 private constant MIN_USDT = 25e6;

    /// @notice Vesting cliff: 6 months (180 days in seconds)
    uint256 private constant CLIFF_DURATION = 180 days;

    /// @notice Cliff unlock: 10% (1000 BPS)
    uint256 private constant CLIFF_UNLOCK_BPS = 1000;

    /// @notice Monthly unlock after cliff: 2.5% (250 BPS)
    uint256 private constant MONTHLY_UNLOCK_BPS = 250;

    /// @notice Referral total BPS: F1 7% + F2 3% = 10%
    uint256 private constant REFERRAL_BPS = 1000;

    // ─── Community NFT tier IDs (matching CommunityNFT.sol constants) ────────

    uint256 private constant BUILDER  = 1;
    uint256 private constant MAKER    = 2;
    uint256 private constant LUMINARY = 3;

    // ─── Package definitions ──────────────────────────────────────────────────

    // packageIndex=0: no package — any amount >= $25, no NFT
    // packageIndex=1: Builder   — min $1,000  / 200,000 MIC / Builder NFT
    // packageIndex=2: Maker     — min $2,500  / 500,000 MIC / Maker NFT
    // packageIndex=3: Luminary  — min $5,000  / 1,000,000 MIC / Luminary NFT

    uint256 private constant PKG1_MIN_USDT = 1_000e6;
    uint256 private constant PKG2_MIN_USDT = 2_500e6;
    uint256 private constant PKG3_MIN_USDT = 5_000e6;

    // ─── Immutables ───────────────────────────────────────────────────────────

    IERC20           public immutable usdt;
    IERC20           public immutable micToken;
    ILockManager     public immutable lockManager;
    ICommunityNFT    public immutable communityNFT;
    IReferralRegistry public immutable referralRegistry;
    IRevenueRouter   public immutable revenueRouter;

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice Total MIC sold so far (18 decimals)
    uint256 public totalSold;

    /// @notice Total USDT raised so far (6 decimals)
    uint256 public totalRaised;

    /// @notice Whether the sale is accepting purchases
    bool public active;

    // ─── Events ───────────────────────────────────────────────────────────────

    /// @notice Emitted on each successful purchase
    /// @param buyer         Buyer address
    /// @param usdtAmount    USDT paid (6 decimals)
    /// @param micAmount     MIC received (18 decimals)
    /// @param packageIndex  Package chosen (0=none, 1=Builder, 2=Maker, 3=Luminary)
    event PreSalePurchase(
        address indexed buyer,
        uint256 usdtAmount,
        uint256 micAmount,
        uint256 packageIndex
    );

    /// @notice Emitted when sale is activated or deactivated
    event SaleActivated(bool active);

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _usdt              USDT token address (6 decimals)
    /// @param _micToken          MIC token address (18 decimals)
    /// @param _lockManager       LockManager contract (SCHEDULE_CREATOR_ROLE granted externally)
    /// @param _communityNFT      CommunityNFT contract (MINTER_ROLE granted externally)
    /// @param _referralRegistry  ReferralRegistry contract (CALLER_ROLE granted externally)
    /// @param _revenueRouter     RevenueRouter contract (DISTRIBUTOR_ROLE granted externally)
    /// @param admin              Granted DEFAULT_ADMIN_ROLE
    constructor(
        address _usdt,
        address _micToken,
        address _lockManager,
        address _communityNFT,
        address _referralRegistry,
        address _revenueRouter,
        address admin
    ) {
        require(_usdt             != address(0), "PS: zero usdt");
        require(_micToken         != address(0), "PS: zero micToken");
        require(_lockManager      != address(0), "PS: zero lockManager");
        require(_communityNFT     != address(0), "PS: zero communityNFT");
        require(_referralRegistry != address(0), "PS: zero referralRegistry");
        require(_revenueRouter    != address(0), "PS: zero revenueRouter");
        require(admin             != address(0), "PS: zero admin");

        usdt             = IERC20(_usdt);
        micToken         = IERC20(_micToken);
        lockManager      = ILockManager(_lockManager);
        communityNFT     = ICommunityNFT(_communityNFT);
        referralRegistry = IReferralRegistry(_referralRegistry);
        revenueRouter    = IRevenueRouter(_revenueRouter);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        active = false;
    }

    // ─── Purchase ─────────────────────────────────────────────────────────────

    /// @notice Purchase MIC in the Pre-Sale round.
    /// @param usdtAmount   USDT amount to pay (6 decimals, must satisfy package minimum)
    /// @param packageIndex 0=no package (≥$25), 1=Builder (≥$1K), 2=Maker (≥$2.5K), 3=Luminary (≥$5K)
    function buy(uint256 usdtAmount, uint256 packageIndex) external nonReentrant {
        require(active,             "PS: not active");
        require(usdtAmount > 0,     "PS: zero amount");
        require(packageIndex <= 3,  "PS: invalid package");

        // ── Validate package minimum ──────────────────────────────────────────
        if (packageIndex == 0) {
            require(usdtAmount >= MIN_USDT, "PS: below minimum");
        } else if (packageIndex == 1) {
            require(usdtAmount >= PKG1_MIN_USDT, "PS: below package min");
        } else if (packageIndex == 2) {
            require(usdtAmount >= PKG2_MIN_USDT, "PS: below package min");
        } else {
            // packageIndex == 3
            require(usdtAmount >= PKG3_MIN_USDT, "PS: below package min");
        }

        // ── Hard cap check ────────────────────────────────────────────────────
        require(totalRaised + usdtAmount <= HARD_CAP, "PS: hard cap reached");

        // ── Calculate MIC amount: usdtAmount * 200 * 1e12 ────────────────────
        // usdtAmount is 6-decimal, MIC is 18-decimal
        // 1 USDT = 200 MIC → micAmount = usdtAmount × 200 × 10^12
        uint256 micAmount = usdtAmount * MIC_PER_USDT * 1e12;

        // ── Allocation check ──────────────────────────────────────────────────
        require(totalSold + micAmount <= ALLOCATION, "PS: allocation exhausted");

        // ── Update state ──────────────────────────────────────────────────────
        totalRaised += usdtAmount;
        totalSold   += micAmount;

        // ── 1. Pull USDT from buyer ───────────────────────────────────────────
        usdt.safeTransferFrom(msg.sender, address(this), usdtAmount);

        // ── 2. Referral distribution ──────────────────────────────────────────
        //    Check if buyer has a referrer via ReferralRegistry
        uint256 netUsdt = usdtAmount;
        address f1 = referralRegistry.referrerOf(msg.sender);
        if (f1 != address(0)) {
            // Referral exists — 10% (F1 7% + F2 3%) goes to ReferralRegistry
            uint256 refAmount = (usdtAmount * REFERRAL_BPS) / 10000;
            netUsdt = usdtAmount - refAmount;

            // Approve ReferralRegistry to pull refAmount from this contract
            usdt.forceApprove(address(referralRegistry), refAmount);
            referralRegistry.distributeReferral(msg.sender, usdtAmount);
        }

        // ── 3. Net USDT → RevenueRouter ───────────────────────────────────────
        usdt.forceApprove(address(revenueRouter), netUsdt);
        revenueRouter.receiveAndDistribute(netUsdt);

        // ── 4. Transfer MIC to buyer (Hybrid Token-Level Lock) ────────────────
        micToken.safeTransfer(msg.sender, micAmount);

        // ── 5. Create vesting schedule via LockManager ────────────────────────
        lockManager.createSchedule(
            msg.sender,
            micAmount,
            CLIFF_DURATION,
            CLIFF_UNLOCK_BPS,
            MONTHLY_UNLOCK_BPS
        );

        // ── 6. Mint Community NFT bonus if package selected ───────────────────
        if (packageIndex == 1) {
            communityNFT.mint(msg.sender, BUILDER);
        } else if (packageIndex == 2) {
            communityNFT.mint(msg.sender, MAKER);
        } else if (packageIndex == 3) {
            communityNFT.mint(msg.sender, LUMINARY);
        }

        emit PreSalePurchase(msg.sender, usdtAmount, micAmount, packageIndex);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Enable or disable purchasing
    function setActive(bool _active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        active = _active;
        emit SaleActivated(_active);
    }
}
