// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDT6 — a 6-decimal stablecoin, used ONLY to prove it is rejected
/// @notice Nothing in production should ever accept this token. It exists so
///         `test/DecimalsGuard.test.ts` can assert that every contract pricing in USD
///         refuses to deploy against a token of the wrong scale.
///
/// @dev    Do not use this as a fixture for ordinary tests — the production token is
///         BSC-USD, which is 18 decimals. Use `MockUSDT`.
contract MockUSDT6 is ERC20 {
    constructor() ERC20("Mock USDT 6dec", "USDT6") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
