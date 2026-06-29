// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MiningPool — Hindex-weighted MIC distribution to MICE holders
/// @notice Backend submits mining scores via ORACLE_ROLE; miners claim rewards.
/// @dev Receives 60% of daily emission from EmissionController.
contract MiningPool is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    IERC20 public immutable micToken;

    // Epoch-based distribution
    uint256 public currentEpoch;

    struct EpochData {
        uint256 totalReward;       // MIC available for this epoch
        uint256 totalWeightedScore; // sum of all miners' Hindex scores
        bool finalized;
    }

    // epoch → EpochData
    mapping(uint256 => EpochData) public epochs;

    // epoch → miner → score
    mapping(uint256 => mapping(address => uint256)) public minerScores;

    // epoch → miner → claimed
    mapping(uint256 => mapping(address => bool)) public claimed;

    event EpochStarted(uint256 indexed epoch);
    event ScoresSubmitted(uint256 indexed epoch, uint256 minerCount);
    event EpochFinalized(uint256 indexed epoch, uint256 totalReward, uint256 totalScore);
    event RewardClaimed(uint256 indexed epoch, address indexed miner, uint256 amount);

    constructor(address _micToken, address admin) {
        require(_micToken != address(0) && admin != address(0), "Pool: zero address");
        micToken = IERC20(_micToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_ROLE, admin);
    }

    /// @notice Start a new epoch (oracle/admin)
    function startEpoch() external onlyRole(ORACLE_ROLE) {
        if (currentEpoch > 0) {
            require(epochs[currentEpoch].finalized, "Pool: current epoch not finalized");
        }
        currentEpoch++;
        emit EpochStarted(currentEpoch);
    }

    /// @notice Submit batch mining scores for current epoch
    /// @param miners Array of miner addresses
    /// @param scores Array of Hindex-weighted scores
    function submitScores(
        address[] calldata miners,
        uint256[] calldata scores
    ) external onlyRole(ORACLE_ROLE) {
        require(miners.length == scores.length, "Pool: length mismatch");
        require(currentEpoch > 0, "Pool: no epoch");
        require(!epochs[currentEpoch].finalized, "Pool: epoch finalized");

        EpochData storage epoch = epochs[currentEpoch];
        for (uint256 i = 0; i < miners.length; i++) {
            // If miner already has a score, subtract old from total
            uint256 oldScore = minerScores[currentEpoch][miners[i]];
            if (oldScore > 0) {
                epoch.totalWeightedScore -= oldScore;
            }
            minerScores[currentEpoch][miners[i]] = scores[i];
            epoch.totalWeightedScore += scores[i];
        }

        emit ScoresSubmitted(currentEpoch, miners.length);
    }

    /// @notice Finalize current epoch — snapshot the reward pool balance
    function finalizeEpoch() external onlyRole(ORACLE_ROLE) {
        require(currentEpoch > 0, "Pool: no epoch");
        EpochData storage epoch = epochs[currentEpoch];
        require(!epoch.finalized, "Pool: already finalized");

        // The reward is whatever MIC balance this contract holds (sent by EmissionController)
        epoch.totalReward = micToken.balanceOf(address(this));
        epoch.finalized = true;

        emit EpochFinalized(currentEpoch, epoch.totalReward, epoch.totalWeightedScore);
    }

    /// @notice Claim mining reward for a finalized epoch
    function claimReward(uint256 epoch) external nonReentrant {
        EpochData storage e = epochs[epoch];
        require(e.finalized, "Pool: epoch not finalized");
        require(!claimed[epoch][msg.sender], "Pool: already claimed");

        uint256 score = minerScores[epoch][msg.sender];
        require(score > 0, "Pool: no score");

        claimed[epoch][msg.sender] = true;

        uint256 reward = (e.totalReward * score) / e.totalWeightedScore;
        require(reward > 0, "Pool: zero reward");

        micToken.safeTransfer(msg.sender, reward);

        emit RewardClaimed(epoch, msg.sender, reward);
    }

    /// @notice View pending reward for a miner in a finalized epoch
    function pendingReward(uint256 epoch, address miner) external view returns (uint256) {
        EpochData storage e = epochs[epoch];
        if (!e.finalized || claimed[epoch][miner] || e.totalWeightedScore == 0) return 0;
        uint256 score = minerScores[epoch][miner];
        return (e.totalReward * score) / e.totalWeightedScore;
    }

    /// @notice Get miner's score for an epoch
    function getScore(uint256 epoch, address miner) external view returns (uint256) {
        return minerScores[epoch][miner];
    }
}
