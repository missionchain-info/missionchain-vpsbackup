// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "../interfaces/ILockManager.sol";

/// @title MICToken — MissionChain Utility Token (BEP-20 on BSC)
/// @notice Hard cap 7B MIC. 15% pre-issued at deploy, 85% minted progressively.
///         Integrates ILockManager for Hybrid Token-Level Lock (vesting).
contract MICToken is ERC20Capped, ERC20Burnable, ERC20Pausable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant TOTAL_SUPPLY_CAP = 7_000_000_000 ether;
    uint256 public constant PRE_ISSUED       = 1_050_000_000 ether;
    uint256 public constant MINING_POOL      = 5_950_000_000 ether;

    uint256 public totalMiningMinted;

    /// @notice LockManager contract — tracks vesting schedules, upgradeable via DAO
    ILockManager public lockManager;

    /// @notice Contracts approved to receive locked MIC (for staking)
    mapping(address => bool) public approvedStakingContracts;

    event MiningMinted(address indexed to, uint256 amount, uint256 totalMiningMinted);
    event LockManagerSet(address indexed oldManager, address indexed newManager);
    event StakingContractApproval(address indexed contract_, bool approved);

    /// @param treasury Address that receives 15% pre-issued tokens + admin roles
    constructor(address treasury) ERC20("MissionChain", "MIC") ERC20Capped(TOTAL_SUPPLY_CAP) {
        require(treasury != address(0), "MIC: zero treasury");
        _grantRole(DEFAULT_ADMIN_ROLE, treasury);
        _grantRole(PAUSER_ROLE, treasury);
        _mint(treasury, PRE_ISSUED);
    }

    /// @notice Set or update the LockManager contract. DAO-controlled.
    function setLockManager(address _lockManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address old = address(lockManager);
        lockManager = ILockManager(_lockManager);
        emit LockManagerSet(old, _lockManager);
    }

    /// @notice Approve or revoke a staking contract for locked MIC transfers.
    function setApprovedStakingContract(address contract_, bool approved)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        approvedStakingContracts[contract_] = approved;
        emit StakingContractApproval(contract_, approved);
    }

    /// @notice Mint from 85% mining pool. Only EmissionController (MINTER_ROLE).
    function mintFromMining(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(totalMiningMinted + amount <= MINING_POOL, "MIC: mining pool exhausted");
        totalMiningMinted += amount;
        _mint(to, amount);
        emit MiningMinted(to, amount, totalMiningMinted);
    }

    function remainingMiningPool() external view returns (uint256) {
        return MINING_POOL - totalMiningMinted;
    }

    /// @notice Get locked balance for an account (via LockManager)
    function lockedBalanceOf(address account) external view returns (uint256) {
        if (address(lockManager) == address(0)) return 0;
        return lockManager.lockedOf(account);
    }

    /// @notice Get available (transferable) balance for an account
    function availableBalanceOf(address account) external view returns (uint256) {
        uint256 total = balanceOf(account);
        if (address(lockManager) == address(0)) return total;
        uint256 locked = lockManager.lockedOf(account);
        return total > locked ? total - locked : 0;
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    /// @dev Override _update to enforce lock + allow approved staking contracts
    function _update(address from, address to, uint256 value)
        internal override(ERC20Capped, ERC20, ERC20Pausable)
    {
        // Skip lock check for:
        // 1. Minting (from == address(0))
        // 2. Transfer TO approved staking contracts (locked MIC staking)
        // 3. Transfer FROM approved staking contracts (unstake return)
        if (
            from != address(0) &&
            address(lockManager) != address(0) &&
            !approvedStakingContracts[to] &&
            !approvedStakingContracts[from]
        ) {
            uint256 locked = lockManager.lockedOf(from);
            uint256 balance = balanceOf(from);
            require(balance - value >= locked, "MIC: transfer exceeds unlocked balance");
        }
        super._update(from, to, value);
    }
}
