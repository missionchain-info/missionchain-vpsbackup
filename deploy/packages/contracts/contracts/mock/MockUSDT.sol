// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDT — stand-in for BSC-USD in tests
/// @notice Free mint for anyone.
///
/// @dev **18 decimals, matching BSC-USD `0x55d398326f99059fF775485246999027B3197955`.**
///
///      This mock returned 6 until 2026-08-08. Every test in the suite therefore ran
///      against a token shaped nothing like the one the contracts actually meet on
///      mainnet, and the whole suite was blind to a class of bug that a single call
///      could have turned into a total loss: `PreSale` priced its hard cap at
///      `1_575_000e6`, so against an 18-decimal token the first buyer could have taken
///      all 315,000,000 MIC for 0.000001575 USDT. The live `SeedSaleV7` had the same
///      shape and had to be halted on mainnet.
///
///      Do not lower this back to 6 to make a test pass. A test that only passes
///      against a 6-decimal token is a test that does not describe production.
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "USDT") {}

    /// @notice Anyone can mint test USDT
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Convenience: mint 10,000 USDT to caller
    function faucet() external {
        _mint(msg.sender, 10_000 ether);
    }
}
