// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CommunityNFTRewardPool — receives 5% of daily MIC emission from EmissionController
/// @notice Accumulates MIC rewards for Community NFT holders (Builder, Maker, Luminary tiers).
/// @dev Distribution is admin/oracle-triggered via batch transfers to a pre-computed recipient list.
///      Off-chain service calculates per-holder reward = (tier multiplier × duration × participation).
contract CommunityNFTRewardPool is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    IERC20 public immutable micToken;

    uint256 public totalDistributed;
    uint256 public distributionCount;

    event RewardDistributed(address indexed recipient, uint256 amount, uint256 indexed epoch);
    event BatchDistributed(uint256 indexed epoch, uint256 recipientCount, uint256 totalAmount);
    event EmergencyWithdraw(address indexed to, uint256 amount);

    constructor(address _micToken, address admin) {
        require(_micToken != address(0) && admin != address(0), "Pool: zero address");
        micToken = IERC20(_micToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DISTRIBUTOR_ROLE, admin);
    }

    /// @notice Current MIC balance held by the pool
    function balance() external view returns (uint256) {
        return micToken.balanceOf(address(this));
    }

    /// @notice Batch distribute MIC to Community NFT holders
    /// @param recipients Addresses of Community NFT holders entitled to rewards
    /// @param amounts MIC amount per recipient (in wei, 18 decimals)
    function distribute(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        require(recipients.length == amounts.length, "Pool: length mismatch");
        require(recipients.length > 0, "Pool: empty recipients");

        uint256 totalAmount;
        uint256 epoch = distributionCount;

        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Pool: zero recipient");
            micToken.safeTransfer(recipients[i], amounts[i]);
            totalAmount += amounts[i];
            emit RewardDistributed(recipients[i], amounts[i], epoch);
        }

        totalDistributed += totalAmount;
        distributionCount++;
        emit BatchDistributed(epoch, recipients.length, totalAmount);
    }

    /// @notice Emergency withdraw (admin only) — for migration or critical fix
    function emergencyWithdraw(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0), "Pool: zero address");
        micToken.safeTransfer(to, amount);
        emit EmergencyWithdraw(to, amount);
    }
}
