// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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
interface IMICBurnable {
    function burn(uint256 amount) external;
}

contract PreSale is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Total MIC allocation for Pre-Sale (4.50% of 7B = 315M MIC)
    uint256 public constant ALLOCATION = 315_000_000 ether;

    /// @notice Hard cap in USDT: 315M MIC × $0.005 = $1,575,000
    /// @dev    18 decimals — BSC-USD `0x55d398326f99059fF775485246999027B3197955` is an
    ///         18-decimal token, NOT the 6-decimal USDT familiar from Ethereum. Until
    ///         2026-08-08 every constant here was written `e6`, which against the real
    ///         token made the whole 315,000,000 MIC allocation buyable for 0.000001575
    ///         USDT in a single call. The constructor now refuses any token that is not
    ///         18 decimals, so this can never be deployed against a mismatched asset.
    uint256 public constant HARD_CAP = 1_575_000 ether;

    /// @notice MIC price: 1 USDT = 200 MIC. Both are 18-decimal, so the conversion is a
    ///         plain multiply — the old `× 1e12` decimal shim is gone with the 6-dec
    ///         assumption that required it.
    uint256 private constant MIC_PER_USDT = 200;

    /// @notice Minimum purchase amount in USDT: $25
    uint256 private constant MIN_USDT = 25 ether;

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

    uint256 private constant PKG1_MIN_USDT = 1_000 ether;
    uint256 private constant PKG2_MIN_USDT = 2_500 ether;
    uint256 private constant PKG3_MIN_USDT = 5_000 ether;

    // ─── Immutables ───────────────────────────────────────────────────────────

    IERC20           public immutable usdt;
    IERC20           public immutable micToken;

    /// @notice Steward Council gate for anything touching the unsold remainder.
    ///         Granted to DAOGovernor, whose propose / approve / execute flow already
    ///         carries the 3-of-5 quorum and the category timelock.
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    /// @notice The round is left alone for six months before the Council may act on
    ///         what has not sold. Buyers get a settled sale, not one whose supply can
    ///         be pulled a week after it opens.
    uint256 public constant UNSOLD_LOCK = 180 days;

    /// @notice Set at deploy; the clock the six months is measured from.
    uint256 public immutable saleStart;
    ILockManager     public immutable lockManager;
    ICommunityNFT    public immutable communityNFT;
    IReferralRegistry public immutable referralRegistry;
    IRevenueRouter   public immutable revenueRouter;

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice Total MIC sold so far (18 decimals)
    uint256 public totalSold;

    /// @notice Total USDT raised so far (18 decimals)
    uint256 public totalRaised;

    /// @notice Whether the sale is accepting purchases
    bool public active;

    /// @notice True once the sale has been opened at least once.
    /// @dev `active` alone cannot gate the unsold remainder: it is false at deploy too,
    ///      which would let the Council empty a round that has never opened. The
    ///      remainder is only reachable early once the sale has actually run and been
    ///      stopped — otherwise it waits out the 180 days.
    bool public everActivated;

    // ─── Events ───────────────────────────────────────────────────────────────

    /// @notice Emitted on each successful purchase
    /// @param buyer         Buyer address
    /// @param usdtAmount    USDT paid (18 decimals)
    /// @param micAmount     MIC received (18 decimals)
    /// @param packageIndex  Package chosen (0=none, 1=Builder, 2=Maker, 3=Luminary)
    event PreSalePurchase(
        address indexed buyer,
        uint256 usdtAmount,
        uint256 micAmount,
        uint256 packageIndex
    );
    event UnsoldMICWithdrawn(address indexed to, uint256 amount);
    event UnsoldMICBurned(uint256 amount, uint256 remaining);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    /// @notice Emitted when sale is activated or deactivated
    event SaleActivated(bool active);

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _usdt              USDT token address — must report 18 decimals
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
        saleStart = block.timestamp;
        require(_usdt             != address(0), "PS: zero usdt");
        require(_micToken         != address(0), "PS: zero micToken");
        require(_lockManager      != address(0), "PS: zero lockManager");
        require(_communityNFT     != address(0), "PS: zero communityNFT");
        require(_referralRegistry != address(0), "PS: zero referralRegistry");
        require(_revenueRouter    != address(0), "PS: zero revenueRouter");
        require(admin             != address(0), "PS: zero admin");

        // Every price in this contract is written in 18 decimals. Deploying against a
        // token of any other scale silently rewrites all of them: against a 6-decimal
        // token the $25 minimum becomes $25,000,000,000,000, and against the 18-decimal
        // token that a 6-decimal contract expects, the whole allocation goes for a
        // millionth of a dollar. Refuse at construction rather than discover it live.
        require(IERC20Metadata(_usdt).decimals() == 18, "PS: usdt must be 18 decimals");

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
    /// @param usdtAmount   USDT amount to pay (18 decimals, must satisfy package minimum)
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

        // ── Calculate MIC amount ─────────────────────────────────────────────
        // USDT and MIC are both 18-decimal, so 1 USDT = 200 MIC is a plain multiply.
        // No decimal shim — the constructor guarantees the token is 18 decimals.
        uint256 micAmount = usdtAmount * MIC_PER_USDT;

        // ── Allocation check ──────────────────────────────────────────────────
        require(totalSold + micAmount <= ALLOCATION, "PS: allocation exhausted");

        // ── Update state ──────────────────────────────────────────────────────
        totalRaised += usdtAmount;
        totalSold   += micAmount;

        // ── 1. Pull GROSS USDT from buyer ─────────────────────────────────────
        usdt.safeTransferFrom(msg.sender, address(this), usdtAmount);

        // ── 2. Send FULL GROSS to RevenueRouter ───────────────────────────────
        //    The router splits 6 ways (all % of gross): Referral 10% → ReferralRegistry,
        //    Marketing 25% → RewardDistributorV2, Mgmt/Treasury/Staking/Liquidity.
        usdt.forceApprove(address(revenueRouter), usdtAmount);
        revenueRouter.receiveAndDistribute(usdtAmount);

        // ── 3. Trigger per-buyer referral payout ──────────────────────────────
        //    The router just deposited the 10% referral slice into the registry; the registry
        //    pays F1 7% + F2 3% to the buyer's upline and routes any unspent portion to the
        //    Milestones & Incentives pool. Also updates Group Volume up the chain.
        referralRegistry.distributeReferral(msg.sender, usdtAmount);

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

    /// @notice Recover MIC that never sold.
    /// @dev The contract is funded with 315,000,000 MIC and `buy()` was, until this was
    ///      added, the only way any of it could leave. A round that does not sell out —
    ///      or a sale abandoned after a defect is found — would have stranded the
    ///      remainder permanently, which is exactly how 105,000,000 MIC was lost in
    ///      TreasuryManager v1. The sale must be stopped first so this can never take
    ///      MIC out from under a buyer mid-transaction.
    function withdrawUnsoldMIC(address to, uint256 amount)
        external onlyRole(DAO_ROLE) nonReentrant
    {
        _requireUnsoldActionAllowed();
        require(to != address(0), "PS: zero recipient");
        require(amount > 0, "PS: zero amount");
        require(amount <= micToken.balanceOf(address(this)), "PS: insufficient MIC");
        micToken.safeTransfer(to, amount);
        emit UnsoldMICWithdrawn(to, amount);
    }

    /// @notice Destroy part of the unsold remainder instead of moving it.
    /// @dev The Council's second option when a round does not sell out. Burning is
    ///      preferred to parking the remainder somewhere, because it needs no ongoing
    ///      trust — but the choice is governance's, so both paths exist.
    function burnUnsoldMIC(uint256 amount) external onlyRole(DAO_ROLE) nonReentrant {
        _requireUnsoldActionAllowed();
        require(amount > 0, "PS: zero amount");
        uint256 held = micToken.balanceOf(address(this));
        require(amount <= held, "PS: insufficient MIC");
        IMICBurnable(address(micToken)).burn(amount);
        emit UnsoldMICBurned(amount, held - amount);
    }

    /// @dev Either 180 days have passed, or the sale has actually run and then been
    ///      stopped. The second case exists so a round abandoned after a defect is found
    ///      is not held hostage by the calendar — but it requires `everActivated`, so a
    ///      round that has never opened cannot be emptied on day one.
    function _requireUnsoldActionAllowed() private view {
        require(
            block.timestamp >= saleStart + UNSOLD_LOCK || (everActivated && !active),
            "PS: locked 180 days unless the sale has run and been stopped"
        );
    }

    /// @notice MIC still held here — what the Council may act on.
    function unsoldMIC() external view returns (uint256) {
        return micToken.balanceOf(address(this));
    }

    /// @notice When the six-month lock lifts.
    function unsoldUnlockAt() external view returns (uint256) {
        return saleStart + UNSOLD_LOCK;
    }


    /// @notice Recover any other token sent here by mistake. MIC is excluded because it
    ///         has its own path above, gated on the sale being stopped.
    function rescueToken(address token, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant
    {
        require(token != address(micToken), "PS: use withdrawUnsoldMIC");
        require(to != address(0), "PS: zero recipient");
        require(amount > 0,       "PS: zero amount");
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }

    /// @notice Enable or disable purchasing
    function setActive(bool _active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_active) everActivated = true;
        active = _active;
        emit SaleActivated(_active);
    }
}
