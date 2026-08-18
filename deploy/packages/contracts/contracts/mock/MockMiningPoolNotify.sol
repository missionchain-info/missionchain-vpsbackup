// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev A miner pool that only records what it was told. EmissionController now requires
///      the pool to acknowledge each distribution, so an EOA can no longer stand in for
///      it — which is the point: silently minting into an address that cannot account for
///      the MIC is exactly the failure this change removes.
contract MockMiningPoolNotify {
    uint256 public totalNotified;
    uint256 public lastAmount;
    uint256 public notifyCount;

    function notifyReward(uint256 amount) external {
        totalNotified += amount;
        lastAmount = amount;
        notifyCount += 1;
    }
}
