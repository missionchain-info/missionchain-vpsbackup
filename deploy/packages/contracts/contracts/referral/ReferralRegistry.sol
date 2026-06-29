// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ReferralRegistry — F1/F2 USDT Commission + GV Tracking
/// @notice Tracks referral relationships (F1/F2) and distributes referral rewards.
///         Both PreSale AND MICELicense call this contract via CALLER_ROLE.
///         F1: 7% USDT / F2: 3% USDT — paid instantly on each purchase.
///         GV (Group Volume) propagates up the ENTIRE upline chain.
///         GV tier and GV bonus rate are read by ClaimRewards for periodic GV payouts.
///         SEED has NO referral — only PreSale and MICE.
contract ReferralRegistry is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Role granted to PreSale and MICELicense contracts
    bytes32 public constant CALLER_ROLE = keccak256("CALLER_ROLE");

    IERC20 public immutable usdt;

    // Fixed commission rates (immutable per spec)
    uint256 public constant F1_BPS = 700;  // 7%
    uint256 public constant F2_BPS = 300;  // 3%

    // GV tier thresholds (USDT 6-decimal format)
    // Tier 0 (Believer):       $0 – $4,999         → 0 BPS
    // Tier 1 (Builder):        $5,000 – $19,999     → 300 BPS (3%)
    // Tier 2 (Connector):      $20,000 – $49,999    → 500 BPS (5%)
    // Tier 3 (Champion):       $50,000 – $149,999   → 700 BPS (7%)
    // Tier 4 (Ambassador):     $150,000 – $499,999  → 800 BPS (8%)
    // Tier 5 (Legend):         $500,000+            → 900 BPS (9%)
    uint256 public constant TIER1_THRESHOLD =   5_000 * 1e6;
    uint256 public constant TIER2_THRESHOLD =  20_000 * 1e6;
    uint256 public constant TIER3_THRESHOLD =  50_000 * 1e6;
    uint256 public constant TIER4_THRESHOLD = 150_000 * 1e6;
    uint256 public constant TIER5_THRESHOLD = 500_000 * 1e6;

    // GV bonus rates in BPS per tier (0–5)
    uint256[6] private GV_RATES = [0, 300, 500, 700, 800, 900];

    /// @notice F1 referrer for each user (one-time, immutable after set)
    mapping(address => address) private _referrerOf;
    mapping(address => bool)    private _registered;

    /// @notice Cumulative Group Volume per address (USDT 6-decimal)
    mapping(address => uint256) public groupVolume;

    /// @notice Monthly GV per address per month index (block.timestamp / 30 days)
    mapping(address => mapping(uint256 => uint256)) public monthlyGV;

    // ── Events ──────────────────────────────────────────────────────────────

    event ReferrerSet(address indexed user, address indexed referrer);
    event RewardDistributed(
        address indexed buyer,
        address indexed f1,
        uint256 f1Amount,
        address indexed f2,
        uint256 f2Amount
    );

    // ── Constructor ──────────────────────────────────────────────────────────

    /// @param _usdt   USDT token address (6 decimals on BSC)
    /// @param admin   Admin address — receives DEFAULT_ADMIN_ROLE
    constructor(address _usdt, address admin) {
        require(_usdt != address(0) && admin != address(0), "Ref: zero address");
        usdt = IERC20(_usdt);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ── External — called by PreSale / MICELicense ───────────────────────────

    /// @notice Register the F1 referrer for a user. One-time and immutable.
    /// @param user     The buyer address
    /// @param referrer The direct referrer (F1)
    function setReferrer(address user, address referrer) external onlyRole(CALLER_ROLE) {
        require(user != address(0) && referrer != address(0), "Ref: zero address");
        require(user != referrer, "Ref: self-referral");
        require(!_registered[user], "Ref: already registered");
        _referrerOf[user] = referrer;
        _registered[user] = true;
        emit ReferrerSet(user, referrer);
    }

    /// @notice Distribute F1/F2 referral commissions and update GV for entire upline.
    /// @dev    Caller (PreSale / MICELicense) must have approved this contract to pull
    ///         `usdtAmount * (F1_BPS + F2_BPS) / 10000` worth of USDT before calling.
    ///         If F1 is absent: 7% stays in this contract (admin can recover).
    ///         If F2 is absent: 3% stays in this contract (admin can recover).
    ///         GV is updated for every ancestor in the upline chain, not just F1/F2.
    /// @param buyer       The buyer address
    /// @param usdtAmount  Total USDT paid by buyer (6 decimals)
    function distributeReferral(address buyer, uint256 usdtAmount)
        external
        onlyRole(CALLER_ROLE)
        nonReentrant
    {
        require(usdtAmount > 0, "Ref: zero amount");

        address f1 = _referrerOf[buyer];
        uint256 f1Amount = (usdtAmount * F1_BPS) / 10000;

        address f2 = f1 != address(0) ? _referrerOf[f1] : address(0);
        uint256 f2Amount = (usdtAmount * F2_BPS) / 10000;

        // Determine how much USDT to pull from caller:
        // - Always pull F1 share (stays in contract if no F1, or pays F1 if present).
        // - Pull F2 share only when F1 exists (otherwise no referral chain at all).
        // This ensures:
        //   No F1  → pull f1Amount only, stays in contract.
        //   F1, no F2 → pull f1Amount + f2Amount; pay F1, keep F2 in contract.
        //   F1 + F2   → pull both, pay both.
        uint256 totalPull = f1 != address(0) ? f1Amount + f2Amount : f1Amount;
        usdt.safeTransferFrom(msg.sender, address(this), totalPull);

        // Pay F1 (or keep in contract if no F1)
        if (f1 != address(0) && f1Amount > 0) {
            usdt.safeTransfer(f1, f1Amount);
        }

        // Pay F2 (or keep in contract if no F2)
        if (f2 != address(0) && f2Amount > 0) {
            usdt.safeTransfer(f2, f2Amount);
        }

        // Update GV for entire upline chain (all generations)
        _updateGVChain(buyer, usdtAmount);

        emit RewardDistributed(buyer, f1, f1Amount, f2, f2Amount);
    }

    // ── View functions ────────────────────────────────────────────────────────

    /// @notice Returns the F1 referrer for a user (zero address if none)
    function referrerOf(address user) external view returns (address) {
        return _referrerOf[user];
    }

    /// @notice Returns the GV tier (0–5) for an address based on cumulative GV
    function getTier(address user) public view returns (uint256) {
        uint256 gv = groupVolume[user];
        if (gv >= TIER5_THRESHOLD) return 5;
        if (gv >= TIER4_THRESHOLD) return 4;
        if (gv >= TIER3_THRESHOLD) return 3;
        if (gv >= TIER2_THRESHOLD) return 2;
        if (gv >= TIER1_THRESHOLD) return 1;
        return 0;
    }

    /// @notice Returns the GV bonus rate in BPS for an address (0/300/500/700/800/900)
    function getGVRate(address user) external view returns (uint256) {
        return GV_RATES[getTier(user)];
    }

    /// @notice Returns the current month index (block.timestamp / 30 days)
    function currentMonthIndex() external view returns (uint256) {
        return _monthIndex();
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /// @dev Walk the upline chain starting from the buyer's F1 referrer,
    ///      adding `amount` to each ancestor's groupVolume and monthlyGV.
    function _updateGVChain(address buyer, uint256 amount) internal {
        uint256 monthIdx = _monthIndex();
        address current = _referrerOf[buyer];
        while (current != address(0)) {
            groupVolume[current] += amount;
            monthlyGV[current][monthIdx] += amount;
            current = _referrerOf[current];
        }
    }

    /// @dev Month index = block.timestamp / (30 days in seconds)
    function _monthIndex() internal view returns (uint256) {
        return block.timestamp / 30 days;
    }
}
