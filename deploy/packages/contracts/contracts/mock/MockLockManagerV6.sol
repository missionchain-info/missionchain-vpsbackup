// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockLockManagerV6 — Mock for testing SeedSaleV6/V7 vesting calls
/// @notice Supports both createSchedule (V1 ILockManager interface) and
///         createScheduleWithStart (used by V6/V7 adminGrantOldInvestor).
///         Records calls; no AccessControl gate so tests don't need role wiring.
contract MockLockManagerV6 {
    struct Schedule {
        address beneficiary;
        uint256 totalAmount;
        uint256 startTime;
        uint256 cliffDuration;
        uint256 cliffUnlockBps;
        uint256 monthlyUnlockBps;
    }

    Schedule[] private _schedules;
    mapping(address => uint256[]) private _byBeneficiary;

    event ScheduleCreated(
        address indexed beneficiary,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 cliffUnlockBps,
        uint256 monthlyUnlockBps
    );

    function createSchedule(
        address beneficiary,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 cliffUnlockBps,
        uint256 monthlyUnlockBps
    ) external {
        _push(beneficiary, totalAmount, block.timestamp, cliffDuration, cliffUnlockBps, monthlyUnlockBps);
    }

    function createScheduleWithStart(
        address beneficiary,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 cliffUnlockBps,
        uint256 monthlyUnlockBps
    ) external {
        _push(beneficiary, totalAmount, startTime, cliffDuration, cliffUnlockBps, monthlyUnlockBps);
    }

    function _push(
        address beneficiary,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 cliffUnlockBps,
        uint256 monthlyUnlockBps
    ) private {
        require(beneficiary != address(0), "MockLM: zero beneficiary");
        require(totalAmount > 0, "MockLM: zero amount");
        _byBeneficiary[beneficiary].push(_schedules.length);
        _schedules.push(Schedule({
            beneficiary: beneficiary,
            totalAmount: totalAmount,
            startTime: startTime,
            cliffDuration: cliffDuration,
            cliffUnlockBps: cliffUnlockBps,
            monthlyUnlockBps: monthlyUnlockBps
        }));
        emit ScheduleCreated(beneficiary, totalAmount, startTime, cliffDuration, cliffUnlockBps, monthlyUnlockBps);
    }

    function scheduleCount(address account) external view returns (uint256) {
        return _byBeneficiary[account].length;
    }

    function getScheduleAt(address account, uint256 index) external view returns (Schedule memory) {
        require(index < _byBeneficiary[account].length, "MockLM: index out of bounds");
        return _schedules[_byBeneficiary[account][index]];
    }

    function totalSchedules() external view returns (uint256) {
        return _schedules.length;
    }
}
