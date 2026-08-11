// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockLiquidityPoolV6 — test double for the Liquidity layer
/// @notice Lets tests drive spot price, the two averages, reserves and the reported
///         emission directly, so Sales- and Emission-layer behaviour can be exercised
///         without standing up a real pool.
contract MockLiquidityPoolV6 {
    uint256 public spotPrice;
    uint256 public twap7d;
    uint256 public twap30d;
    uint256 public reserveUsdt;
    uint256 public lastReportedEmission;

    /// @dev Mirrors the real pool: seeded once it has a price to quote. Tests that want
    ///      the pre-seed state set the prices to zero.
    bool public seededOverride;
    bool public seededOverrideSet;

    function setSeeded(bool v) external { seededOverride = v; seededOverrideSet = true; }

    function isSeeded() external view returns (bool) {
        if (seededOverrideSet) return seededOverride;
        return spotPrice > 0;
    }

    function setPrices(uint256 _spot, uint256 _t7, uint256 _t30) external {
        spotPrice = _spot;
        twap7d = _t7;
        twap30d = _t30;
    }

    function setReserveUsdt(uint256 v) external { reserveUsdt = v; }

    function reportDailyEmission(uint256 avg7d) external { lastReportedEmission = avg7d; }
}
