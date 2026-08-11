// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ILP6 {
    function swapUsdtToMic(uint256 usdtIn, uint256 minMicOut) external returns (uint256);
    function swapMicToUsdt(uint256 micIn, uint256 minUsdtOut) external returns (uint256);
}

/// @notice Test double that attempts a buy and a sell inside one transaction, which is
///         the shape a sandwich takes. The pool must refuse it.
contract MockSameBlockTrader {
    ILP6 public immutable pool;
    IERC20 public immutable usdt;
    IERC20 public immutable mic;

    constructor(address _pool, address _usdt, address _mic) {
        pool = ILP6(_pool);
        usdt = IERC20(_usdt);
        mic = IERC20(_mic);
        IERC20(_usdt).approve(_pool, type(uint256).max);
        IERC20(_mic).approve(_pool, type(uint256).max);
    }

    function buyThenSell(uint256 usdtIn) external {
        uint256 got = pool.swapUsdtToMic(usdtIn, 0);
        pool.swapMicToUsdt(got, 0);
    }
}
