// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Simple mock target for DAOGovernor proposal execution tests
contract MockCallTarget {
    uint256 public callCount;
    uint256 public value;

    event Called();
    event ValueSet(uint256 newValue);

    function doSomething() external {
        callCount++;
        emit Called();
    }

    function setValue(uint256 _value) external {
        value = _value;
        emit ValueSet(_value);
    }
}
