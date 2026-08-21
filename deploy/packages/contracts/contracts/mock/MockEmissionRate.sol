// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockEmissionRate — the one number LiquidityPoolV8 reads from the Emission layer
/// @notice Lets a test move daily issuance and assert the pool's allowance follows it,
///         which is the whole point of storing the quota as a ratio rather than an amount.
contract MockEmissionRate {
    uint256 public micPerLicencePerDay;

    constructor(uint256 rate) {
        micPerLicencePerDay = rate;
    }

    function setRate(uint256 rate) external {
        micPerLicencePerDay = rate;
    }
}
