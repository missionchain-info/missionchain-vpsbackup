// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockRewardReceiver — test double for pull-based reward sinks
/// @notice Implements both `receiveAndDistribute` (RewardDistributorV2) and `receiveUSDT`
///         (sub-pools) so it can stand in as the "marketing" target of RevenueRouter or any
///         DISTRIBUTOR-funded pool in unit tests. Simply pulls and records the amount.
contract MockRewardReceiver {
    using SafeERC20 for IERC20;
    IERC20 public immutable usdt;
    uint256 public received;

    constructor(address _usdt) {
        usdt = IERC20(_usdt);
    }

    function receiveAndDistribute(uint256 amount) external {
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        received += amount;
    }

    function receiveUSDT(uint256 amount) external {
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        received += amount;
    }

    function receiveOverflow(uint256 amount) external {
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        received += amount;
    }
}
