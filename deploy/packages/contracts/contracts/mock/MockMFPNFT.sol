// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockMFPNFT — Lightweight MFPNFT mock for testing large batch mints
/// @notice Records mint calls without ERC-721 overhead. Useful for gas-heavy tests
///         (e.g., 150 or 350 NFTs per package) that exceed Hardhat's EDR gas cap.
contract MockMFPNFT {
    mapping(address => uint256) public balanceOf;
    uint256 public totalMinted;

    event BatchMinted(address indexed to, uint256 amount);

    function mintBatch(address to, uint256 amount) external {
        require(to != address(0), "MockMFPNFT: zero address");
        balanceOf[to] += amount;
        totalMinted += amount;
        emit BatchMinted(to, amount);
    }
}
