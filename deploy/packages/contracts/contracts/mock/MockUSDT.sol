// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDT — Test USDT for BSC Testnet
/// @notice Free mint for anyone. 6 decimals like real USDT.
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "USDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Anyone can mint test USDT
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Convenience: mint 10,000 USDT to caller
    function faucet() external {
        _mint(msg.sender, 10_000 * 10**6);
    }
}
