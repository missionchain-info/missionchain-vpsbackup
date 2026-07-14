// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ILockManager — Interface for Hybrid Token-Level Lock
/// @notice LockManager tracks vesting schedules per address.
///         Tokens are in user wallets (not held by contract).
///         lockedOf() is a view function (zero gas).
interface ILockManager {
    struct VestingSchedule {
        uint256 totalAmount;
        uint256 startTime;        // block.timestamp at purchase
        uint256 cliffDuration;    // seconds (6 months = 15552000, 24 months = 62208000)
        uint256 cliffUnlockBps;   // 1000 = 10%
        uint256 monthlyUnlockBps; // 250 = 2.5%, 25 = 0.25%
    }

    function lockedOf(address account) external view returns (uint256);
    function availableOf(address account) external view returns (uint256);
    function createSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 cliffUnlockBps,
        uint256 monthlyUnlockBps
    ) external;
    function getSchedules(address account) external view returns (VestingSchedule[] memory);
    function getScheduleAt(address account, uint256 index) external view returns (VestingSchedule memory);
    function scheduleCount(address account) external view returns (uint256);

    event ScheduleCreated(
        address indexed beneficiary,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 cliffUnlockBps,
        uint256 monthlyUnlockBps
    );
}
