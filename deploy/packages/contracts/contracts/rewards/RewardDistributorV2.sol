// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Every reward sub-pool is funded via approve + receiveUSDT (pull pattern).
interface IUSDTReceiver {
    function receiveUSDT(uint256 amount) external;
}

/// @title RewardDistributorV2 — 25% Marketing Splitter (Deck p.17, revised 2026-07)
/// @notice Receives the 25% Marketing & Sales portion from RevenueRouter and routes it
///         to 4 destinations. Referral (F1 7% + F2 3% = 10%) is NOT here — it is paid
///         instantly per-buyer upstream in PreSale/MICELicense. Percentages below are of
///         GROSS revenue (the Marketing bucket = 25% of gross):
///
///           ClaimRewards       10.5%  (GV Override 9% + Milestones & Incentives 1.5%)
///           Weekly Growth       5.5%  (NFTRewardPool: Community NFT 5% + MFP 0.5%)
///           Monthly Community   8.0%  (NFTRewardPool: Community NFT 7.5% + MFP 0.5%)
///           Weekly Lucky Draw   1.0%
///
///         As BPS of the 25% Marketing bucket: 4200 / 2200 / 3200 / 400 = 10000.
///         Supersedes RewardDistributor + PeriodicRewards + IncentivePool for Phase 1.
/// @dev    BPS are DAO-adjustable (±200 BPS / change, 14-day cooldown), must sum to 10000.
contract RewardDistributorV2 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    IERC20 public immutable usdt;

    /// @notice ClaimRewards — Referral Reserve + GV Override + Milestone + Incentive (20.5%)
    address public claimRewards;
    /// @notice NFTRewardPool (Weekly Growth) — Community NFT 5% + MFP 0.5% (5.5%)
    address public weeklyGrowth;
    /// @notice NFTRewardPool (Monthly Community) — Community NFT 7.5% + MFP 0.5% (8%)
    address public monthlyCommunity;
    /// @notice LuckyDraw — Weekly Lucky Draw (1%)
    address public luckyDraw;

    uint256 public bpsClaim;   // 4200 = 10.5% of gross (GV 9% + Milestones & Incentives 1.5%)
    uint256 public bpsWeekly;  // 2200 = 5.5%  of gross
    uint256 public bpsMonthly; // 3200 = 8%    of gross
    uint256 public bpsLucky;   // 400  = 1%    of gross (absorbs rounding dust)

    uint256 public constant BPS_ADJUSTMENT_COOLDOWN = 14 days;
    uint256 public constant MAX_BPS_CHANGE          = 200;
    uint256 public constant BPS_TOTAL               = 10_000;
    uint256 public lastAdjustmentTime;

    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    event RewardDistributed(address indexed caller, uint256 totalAmount);
    event BPSAdjusted(uint256 claim, uint256 weekly, uint256 monthly, uint256 lucky);

    constructor(
        address _usdt,
        address _claimRewards,
        address _weeklyGrowth,
        address _monthlyCommunity,
        address _luckyDraw,
        address _admin
    ) {
        require(_usdt != address(0), "RDv2: zero addr");
        require(_claimRewards != address(0), "RDv2: zero addr");
        require(_weeklyGrowth != address(0), "RDv2: zero addr");
        require(_monthlyCommunity != address(0), "RDv2: zero addr");
        require(_luckyDraw != address(0), "RDv2: zero addr");
        require(_admin != address(0), "RDv2: zero addr");

        usdt             = IERC20(_usdt);
        claimRewards     = _claimRewards;
        weeklyGrowth     = _weeklyGrowth;
        monthlyCommunity = _monthlyCommunity;
        luckyDraw        = _luckyDraw;

        bpsClaim   = 4200; // 10.5% of gross (GV 9% + Milestones & Incentives 1.5%)
        bpsWeekly  = 2200; // 5.5%  of gross
        bpsMonthly = 3200; // 8%    of gross
        bpsLucky   = 400;  // 1%    of gross (absorbs dust)

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    /// @notice Called by RevenueRouter (DISTRIBUTOR_ROLE). Pulls `amount` then funds the 4 pools.
    function receiveAndDistribute(uint256 amount) external nonReentrant onlyRole(DISTRIBUTOR_ROLE) {
        require(amount > 0, "RDv2: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        uint256 toClaim   = (amount * bpsClaim)   / BPS_TOTAL;
        uint256 toWeekly  = (amount * bpsWeekly)  / BPS_TOTAL;
        uint256 toMonthly = (amount * bpsMonthly) / BPS_TOTAL;
        uint256 toLucky   = amount - toClaim - toWeekly - toMonthly; // dust -> lucky

        _fund(claimRewards,     toClaim);
        _fund(weeklyGrowth,     toWeekly);
        _fund(monthlyCommunity, toMonthly);
        _fund(luckyDraw,        toLucky);

        emit RewardDistributed(msg.sender, amount);
    }

    function _fund(address target, uint256 amt) private {
        if (amt == 0) return;
        usdt.forceApprove(target, amt);
        IUSDTReceiver(target).receiveUSDT(amt);
    }

    /// @notice DAO-governed BPS adjustment (±200 / change, 14-day cooldown, sum = 10000).
    function adjustBPS(uint256 newClaim, uint256 newWeekly, uint256 newMonthly, uint256 newLucky)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(block.timestamp >= lastAdjustmentTime + BPS_ADJUSTMENT_COOLDOWN, "RDv2: cooldown active");
        require(newClaim + newWeekly + newMonthly + newLucky == BPS_TOTAL, "RDv2: total must be 10000");
        _checkBPSChange(bpsClaim, newClaim);
        _checkBPSChange(bpsWeekly, newWeekly);
        _checkBPSChange(bpsMonthly, newMonthly);
        _checkBPSChange(bpsLucky, newLucky);

        bpsClaim = newClaim; bpsWeekly = newWeekly; bpsMonthly = newMonthly; bpsLucky = newLucky;
        lastAdjustmentTime = block.timestamp;
        emit BPSAdjusted(newClaim, newWeekly, newMonthly, newLucky);
    }

    function _checkBPSChange(uint256 oldVal, uint256 newVal) private pure {
        uint256 diff = oldVal > newVal ? oldVal - newVal : newVal - oldVal;
        require(diff <= MAX_BPS_CHANGE, "RDv2: change exceeds max");
    }

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Recover ERC-20 tokens sent here by mistake.
    /// @dev A contract that can hold a token must be able to send it. `TreasuryManager`
    ///      v1 could not, and 105,000,000 MIC is stranded there permanently as a result.
    ///      These contracts are not upgradeable, so this cannot be added later.
    ///      receiveAndDistribute forwards everything in the same call, so nothing rests here by
    ///      design. Any resting balance is a stray deposit and may be recovered in full.
    function rescueToken(address token, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant
    {
        require(to != address(0), "REW: zero recipient");
        require(amount > 0,       "REW: zero amount");
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }
}
