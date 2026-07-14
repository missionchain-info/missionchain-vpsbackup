// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "../interfaces/ILockManager.sol";

/// @title LockManager — Hybrid Token-Level Lock (replaces VestingManager)
/// @notice Tracks vesting schedules per address. Does NOT hold tokens.
///         Tokens go directly to user wallets. lockedOf() is a view function (zero gas).
///         Each purchase creates a separate schedule with startTime = block.timestamp.
contract LockManager is ILockManager, AccessControl {
    bytes32 public constant SCHEDULE_CREATOR_ROLE = keccak256("SCHEDULE_CREATOR");

    /// @dev All schedules for each beneficiary
    mapping(address => VestingSchedule[]) private _schedules;

    uint256 private constant MONTH = 30 days;
    uint256 private constant BPS = 10_000;

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Create a new vesting schedule for a beneficiary.
    /// @param beneficiary The address whose tokens are locked
    /// @param totalAmount Total MIC amount locked
    /// @param cliffDuration Seconds until cliff (e.g. 6 months = 15552000)
    /// @param cliffUnlockBps Basis points unlocked at cliff (1000 = 10%)
    /// @param monthlyUnlockBps Basis points unlocked per month after cliff (250 = 2.5%)
    function createSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 cliffUnlockBps,
        uint256 monthlyUnlockBps
    ) external onlyRole(SCHEDULE_CREATOR_ROLE) {
        require(beneficiary != address(0), "LM: zero address");
        require(totalAmount > 0, "LM: zero amount");
        require(cliffUnlockBps + monthlyUnlockBps > 0, "LM: zero unlock");
        require(cliffUnlockBps <= BPS, "LM: cliff > 100%");

        _schedules[beneficiary].push(VestingSchedule({
            totalAmount: totalAmount,
            startTime: block.timestamp,
            cliffDuration: cliffDuration,
            cliffUnlockBps: cliffUnlockBps,
            monthlyUnlockBps: monthlyUnlockBps
        }));

        emit ScheduleCreated(beneficiary, totalAmount, cliffDuration, cliffUnlockBps, monthlyUnlockBps);
    }

    /// @notice Total locked amount for an account (sum of all schedules).
    ///         View function — zero gas when called externally.
    function lockedOf(address account) external view returns (uint256 totalLocked) {
        VestingSchedule[] storage scheds = _schedules[account];
        for (uint256 i = 0; i < scheds.length; i++) {
            totalLocked += _lockedForSchedule(scheds[i]);
        }
    }

    /// @notice Total available (unlocked) amount for an account.
    function availableOf(address account) external view returns (uint256 totalAvailable) {
        VestingSchedule[] storage scheds = _schedules[account];
        for (uint256 i = 0; i < scheds.length; i++) {
            VestingSchedule storage s = scheds[i];
            totalAvailable += s.totalAmount - _lockedForSchedule(s);
        }
    }

    /// @notice Get all schedules for an account.
    function getSchedules(address account) external view returns (VestingSchedule[] memory) {
        return _schedules[account];
    }

    /// @notice Get a single schedule by index.
    function getScheduleAt(address account, uint256 index) external view returns (VestingSchedule memory) {
        require(index < _schedules[account].length, "LM: index out of bounds");
        return _schedules[account][index];
    }

    /// @notice Number of schedules for an account.
    function scheduleCount(address account) external view returns (uint256) {
        return _schedules[account].length;
    }

    /// @dev Calculate locked amount for a single schedule.
    function _lockedForSchedule(VestingSchedule storage s) private view returns (uint256) {
        uint256 elapsed = block.timestamp - s.startTime;

        // Before cliff: 100% locked
        if (elapsed < s.cliffDuration) {
            return s.totalAmount;
        }

        // At and after cliff: calculate unlocked
        uint256 unlockedBps = s.cliffUnlockBps;

        // Monthly unlock after cliff
        uint256 monthsAfterCliff = (elapsed - s.cliffDuration) / MONTH;
        unlockedBps += monthsAfterCliff * s.monthlyUnlockBps;

        // Cap at 100%
        if (unlockedBps >= BPS) {
            return 0; // Fully vested
        }

        uint256 unlocked = (s.totalAmount * unlockedBps) / BPS;
        return s.totalAmount - unlocked;
    }
}
