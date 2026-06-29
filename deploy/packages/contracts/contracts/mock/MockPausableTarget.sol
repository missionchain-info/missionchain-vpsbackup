// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Simple mock pausable target for DAOGovernor emergency tests
contract MockPausableTarget {
    bool public paused;

    event Paused(address by);

    function pause() external {
        paused = true;
        emit Paused(msg.sender);
    }
}
