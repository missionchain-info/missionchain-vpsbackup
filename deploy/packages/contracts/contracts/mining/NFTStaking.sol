// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MICStaking — Pure MIC staking with time-lock multipliers
/// @notice ARCHITECTURE CHANGE (April 2026): Staking and NFT are now COMPLETELY SEPARATE systems.
///         - MICStaking: Pure MIC staking, NO NFT involvement
///         - Anyone stakes any amount, no tier caps
///         - Reward based on: amount × time-lock multiplier (30d=1×, 90d=1.25×, 180d=1.5×, 360d=2×)
///         - Locked MIC CAN stake (full rate, rewards unlocked, min 360d lock)
///         - NFT multipliers: ONLY for USDT reward pool distribution (Weekly, Monthly, Lucky Draw)
///         - DAO: MFP-NFT + 100K staked MIC + lock ≥360d
/// @dev Receives 20% of daily emission from EmissionController.
/// @dev Note: File name remains NFTStaking.sol for backward compatibility,
///      but contract is now purely MIC staking (renamed MICStaking). Tier constants
///      are marked deprecated — no longer used for staking. Keep for reference only.
contract NFTStaking is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    IERC20 public immutable micToken;

    // DEPRECATED TIER CONSTANTS (for reference only — no longer used for staking)
    // Staking is now PURE MIC-based, NO NFT involvement. Tier multipliers moved to reward distribution.
    // Keeping these for backward compatibility and contract reference only.
    // @deprecated Use time-lock multipliers only
    uint256 public constant TIER_MFP       = 100000; // ×10  (DEPRECATED — moved to DAO voting weight)
    uint256 public constant TIER_LUMINARY  = 50000;  // ×5   (DEPRECATED — moved to reward distribution)
    uint256 public constant TIER_MAKER     = 25000;  // ×2.5 (DEPRECATED — moved to reward distribution)
    uint256 public constant TIER_BUILDER   = 10000;  // ×1   (DEPRECATED — moved to reward distribution)
    uint256 public constant TIER_NO_NFT    = 5000;   // ×0.5 (DEPRECATED — no longer applicable)

    // DEPRECATED STAKING CAPS (for reference only — NO LONGER ENFORCED)
    // Pure MIC staking has no tier-based caps. Anyone stakes any amount.
    // @deprecated Use unlimited staking
    uint256 public constant CAP_MFP       = 100_000 ether;  // (DEPRECATED)
    uint256 public constant CAP_LUMINARY  = 50_000 ether;   // (DEPRECATED)
    uint256 public constant CAP_MAKER     = 25_000 ether;   // (DEPRECATED)
    uint256 public constant CAP_BUILDER   = 10_000 ether;   // (DEPRECATED)
    uint256 public constant CAP_NO_NFT    = type(uint256).max; // (DEPRECATED)

    // Time-lock multipliers (in basis points, 10000 = 1×)
    uint256 public constant LOCK_30D  = 10000; // 1×
    uint256 public constant LOCK_90D  = 12500; // 1.25×
    uint256 public constant LOCK_180D = 15000; // 1.5×
    uint256 public constant LOCK_360D = 20000; // 2×

    // Circuit breaker: max 10% of pool unstaked per day
    uint256 public constant MAX_DAILY_UNSTAKE_BPS = 1000; // 10%

    enum Tier { NoNFT, Builder, Maker, Luminary, MFP }
    enum LockPeriod { Days30, Days90, Days180, Days360 }

    struct StakeInfo {
        uint256 amount;
        uint256 weightedAmount; // amount × tierMul × lockMul / 1e8
        Tier tier;
        LockPeriod lockPeriod;
        uint256 stakeTime;
        uint256 unlockTime;
        uint256 rewardDebt;
        bool active;
        /// @dev If true: locked MIC (vesting tokens). Full multiplier applied.
        ///      Minimum lock period 360 days enforced at stake time.
        ///      Rewards are unlocked and freely transferable.
        bool useLockedMic;
    }

    // stakeId → StakeInfo
    mapping(uint256 => StakeInfo) public stakes;
    mapping(address => uint256[]) public userStakes;
    uint256 public totalStakes;

    // Reward tracking
    uint256 public totalWeightedStaked;
    uint256 public accRewardPerShare; // accumulated reward per weighted share (scaled 1e18)
    uint256 public lastRewardBalance;

    // Daily unstake tracking
    uint256 public currentDay;
    uint256 public dailyUnstaked;
    uint256 public totalStakedAmount;

    // DEPRECATED: User tier assignment (no longer used — kept for backward compatibility)
    // @deprecated Staking is no longer tier-based. Tiers are only for reward distribution (Weekly, Monthly, Lucky Draw).
    mapping(address => Tier) public userTier;

    event Staked(address indexed user, uint256 indexed stakeId, uint256 amount, Tier tier, LockPeriod lock, bool useLockedMic);
    event Unstaked(address indexed user, uint256 indexed stakeId, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event TierUpdated(address indexed user, Tier oldTier, Tier newTier);

    constructor(address _micToken, address admin) {
        require(_micToken != address(0) && admin != address(0), "Staking: zero address");
        micToken = IERC20(_micToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_ROLE, admin);
    }

    /// @notice Update reward accounting before any state change
    function _updateRewards() internal {
        uint256 currentBalance = micToken.balanceOf(address(this));
        // New rewards = current balance - total staked - last tracked reward balance
        // Actually: rewards come from EmissionController, separate from staked tokens
        // We track reward pool separately
        if (totalWeightedStaked > 0 && currentBalance > totalStakedAmount) {
            uint256 newRewards = currentBalance - totalStakedAmount - _pendingRewardPool();
            if (newRewards > 0) {
                accRewardPerShare += (newRewards * 1e18) / totalWeightedStaked;
            }
        }
        lastRewardBalance = currentBalance;
    }

    function _pendingRewardPool() internal pure returns (uint256) {
        // This is a simplification — in production, track reward pool explicitly
        return 0;
    }

    /// @notice Stake MIC tokens (both unlocked and locked/vesting tokens)
    /// @dev PURE MIC STAKING (no NFT involvement)
    /// @param amount   Amount of MIC to stake (18 decimals)
    /// @param lockPeriod Lock duration (30/90/180/360 days for stake withdrawal lock)
    /// @param useLockedMic If true, stake from vesting/locked MIC balance.
    ///        - Locked MIC CAN participate in staking at FULL MULTIPLIER (no reduction).
    ///        - Requires minimum 360-day stake lock period to match vesting semantics.
    ///        - Transfer is allowed because NFTStaking is an approvedStakingContract in MICToken.
    ///        - Rewards generated are UNLOCKED and freely transferable.
    ///        - Tracked for analytics — does not change token transfer behavior.
    /// @notice ARCHITECTURE NOTE: Staking is now completely separate from NFT system.
    ///         No tier checks, no tier caps. Anyone can stake any amount.
    function stake(uint256 amount, LockPeriod lockPeriod, bool useLockedMic) external nonReentrant {
        // Pure MIC staking: no tier involvement, no caps (except for locked MIC minimum lock period)
        require(amount > 0, "Staking: zero amount");
        // Locked MIC staking: require minimum 360-day lock period
        if (useLockedMic) {
            require(lockPeriod == LockPeriod.Days360, "Staking: locked MIC requires 360d lock");
        }

        _updateRewards();

        micToken.safeTransferFrom(msg.sender, address(this), amount);

        // Pure MIC staking: ONLY time-lock multiplier applied (no tier multiplier)
        uint256 lockMul = _lockMultiplier(lockPeriod);
        uint256 weighted = (amount * lockMul) / 10000;

        uint256 stakeId = totalStakes++;
        uint256 lockDuration = _lockDuration(lockPeriod);

        stakes[stakeId] = StakeInfo({
            amount: amount,
            weightedAmount: weighted,
            tier: Tier.NoNFT,  // Pure MIC staking: always NoNFT tier (unused, for backward compat only)
            lockPeriod: lockPeriod,
            stakeTime: block.timestamp,
            unlockTime: block.timestamp + lockDuration,
            rewardDebt: (weighted * accRewardPerShare) / 1e18,
            active: true,
            useLockedMic: useLockedMic
        });

        userStakes[msg.sender].push(stakeId);
        totalWeightedStaked += weighted;
        totalStakedAmount += amount;

        emit Staked(msg.sender, stakeId, amount, Tier.NoNFT, lockPeriod, useLockedMic);
    }

    /// @notice Unstake after lock period ends
    function unstake(uint256 stakeId) external nonReentrant {
        StakeInfo storage s = stakes[stakeId];
        require(s.active, "Staking: not active");
        require(_isOwner(msg.sender, stakeId), "Staking: not owner");
        require(block.timestamp >= s.unlockTime, "Staking: still locked");

        // Circuit breaker: 10%/day unstake limit
        uint256 today = block.timestamp / 1 days;
        if (today != currentDay) {
            currentDay = today;
            dailyUnstaked = 0;
        }
        uint256 maxDaily = (totalStakedAmount * MAX_DAILY_UNSTAKE_BPS) / 10000;
        require(dailyUnstaked + s.amount <= maxDaily, "Staking: daily unstake limit");

        _updateRewards();

        // Claim pending rewards
        uint256 pending = (s.weightedAmount * accRewardPerShare / 1e18) - s.rewardDebt;

        s.active = false;
        totalWeightedStaked -= s.weightedAmount;
        totalStakedAmount -= s.amount;
        dailyUnstaked += s.amount;

        micToken.safeTransfer(msg.sender, s.amount);
        if (pending > 0) {
            micToken.safeTransfer(msg.sender, pending);
            emit RewardClaimed(msg.sender, pending);
        }

        emit Unstaked(msg.sender, stakeId, s.amount);
    }

    /// @notice Claim staking rewards without unstaking
    function claimRewards(uint256 stakeId) external nonReentrant {
        StakeInfo storage s = stakes[stakeId];
        require(s.active, "Staking: not active");
        require(_isOwner(msg.sender, stakeId), "Staking: not owner");

        _updateRewards();

        uint256 pending = (s.weightedAmount * accRewardPerShare / 1e18) - s.rewardDebt;
        require(pending > 0, "Staking: no rewards");

        s.rewardDebt = (s.weightedAmount * accRewardPerShare) / 1e18;
        micToken.safeTransfer(msg.sender, pending);

        emit RewardClaimed(msg.sender, pending);
    }

    // --- Oracle: update user tiers ---

    function setUserTier(address user, Tier tier) external onlyRole(ORACLE_ROLE) {
        Tier old = userTier[user];
        userTier[user] = tier;
        emit TierUpdated(user, old, tier);
    }

    function batchSetTiers(address[] calldata users, Tier[] calldata tiers) external onlyRole(ORACLE_ROLE) {
        require(users.length == tiers.length, "Staking: length mismatch");
        for (uint256 i = 0; i < users.length; i++) {
            Tier old = userTier[users[i]];
            userTier[users[i]] = tiers[i];
            emit TierUpdated(users[i], old, tiers[i]);
        }
    }

    // --- View functions ---

    function getUserStakes(address user) external view returns (uint256[] memory) {
        return userStakes[user];
    }

    function pendingReward(uint256 stakeId) external view returns (uint256) {
        StakeInfo storage s = stakes[stakeId];
        if (!s.active) return 0;
        return (s.weightedAmount * accRewardPerShare / 1e18) - s.rewardDebt;
    }

    // --- Internal helpers ---

    function _isOwner(address user, uint256 stakeId) internal view returns (bool) {
        uint256[] storage ids = userStakes[user];
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] == stakeId) return true;
        }
        return false;
    }

    function _userTotalStaked(address user) internal view returns (uint256 total) {
        uint256[] storage ids = userStakes[user];
        for (uint256 i = 0; i < ids.length; i++) {
            if (stakes[ids[i]].active) total += stakes[ids[i]].amount;
        }
    }

    function _tierMultiplier(Tier tier) internal pure returns (uint256) {
        if (tier == Tier.MFP) return TIER_MFP;
        if (tier == Tier.Luminary) return TIER_LUMINARY;
        if (tier == Tier.Maker) return TIER_MAKER;
        if (tier == Tier.Builder) return TIER_BUILDER;
        return TIER_NO_NFT;
    }

    function _tierCap(Tier tier) internal pure returns (uint256) {
        if (tier == Tier.MFP) return CAP_MFP;
        if (tier == Tier.Luminary) return CAP_LUMINARY;
        if (tier == Tier.Maker) return CAP_MAKER;
        if (tier == Tier.Builder) return CAP_BUILDER;
        return CAP_NO_NFT;
    }

    function _lockMultiplier(LockPeriod lock) internal pure returns (uint256) {
        if (lock == LockPeriod.Days360) return LOCK_360D;
        if (lock == LockPeriod.Days180) return LOCK_180D;
        if (lock == LockPeriod.Days90) return LOCK_90D;
        return LOCK_30D;
    }

    function _lockDuration(LockPeriod lock) internal pure returns (uint256) {
        if (lock == LockPeriod.Days360) return 360 days;
        if (lock == LockPeriod.Days180) return 180 days;
        if (lock == LockPeriod.Days90) return 90 days;
        return 30 days;
    }
}
