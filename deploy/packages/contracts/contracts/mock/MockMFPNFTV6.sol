// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockMFPNFTV6 — Mock for testing SeedSaleV6/V7 autoGrantFromSeed flow
/// @notice Records autoGrantFromSeed & grantMintAllowance calls without ERC-721 overhead.
///         Models the on-chain (BSC testnet) MFPNFT that exposes these functions; the
///         in-repo MFPNFT.sol predates that interface and only has mintBatch.
contract MockMFPNFTV6 {
    mapping(address => uint256) public mintAllowance;
    uint256 public totalAllowanceGranted;

    event AutoGrantFromSeed(address indexed to, uint256 amount);
    event MintAllowanceGranted(address indexed to, uint256 amount);

    function autoGrantFromSeed(address to, uint256 amount) external {
        require(to != address(0), "MockMFP: zero address");
        mintAllowance[to] += amount;
        totalAllowanceGranted += amount;
        emit AutoGrantFromSeed(to, amount);
    }

    function grantMintAllowance(address to, uint256 amount) external {
        require(to != address(0), "MockMFP: zero address");
        mintAllowance[to] += amount;
        totalAllowanceGranted += amount;
        emit MintAllowanceGranted(to, amount);
    }
}
