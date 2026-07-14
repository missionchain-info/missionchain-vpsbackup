// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ManagementPool — 7.5% Leadership Auto-Accumulate & Self-Claim
/// @notice Receives 7.5% of net revenue from RevenueRouter (PreSale + MICE).
///         Splits among 6 leadership roles + DAO-controlled bonus pool.
///         Each role holder self-claims their accumulated USDT.
///
/// @dev Role splits (relative to 100% of what this contract receives):
///   Founder        20%   (2000 BPS)
///   Architect      13.33% (1333 BPS)
///   CTO            6.67%  (667 BPS)
///   Social Media   6.67%  (667 BPS)
///   Global Training 6.67% (667 BPS)
///   Tech Team      13.33% (1333 BPS)
///   Bonus (DAO)    33.33% (3333 BPS)
///   Total          100%   (10000 BPS)
contract ManagementPool is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ───
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // ─── Role Indices (0-5) ───
    uint256 public constant ROLE_FOUNDER         = 0;
    uint256 public constant ROLE_ARCHITECT       = 1;
    uint256 public constant ROLE_CTO             = 2;
    uint256 public constant ROLE_SOCIAL_MEDIA    = 3;
    uint256 public constant ROLE_GLOBAL_TRAINING = 4;
    uint256 public constant ROLE_TECH_TEAM       = 5;
    uint256 public constant ROLE_COUNT           = 6;

    // ─── BPS Splits (out of 10000) ───
    uint256 public constant BONUS_BPS = 3333; // 33.33% — DAO bonus pool
    uint256[6] private _roleBps = [
        2000, // Founder        20%
        1333, // Architect      13.33%
        667,  // CTO            6.67%
        667,  // Social Media   6.67%
        667,  // Global Training 6.67%
        1333  // Tech Team      13.33%
    ];

    // ─── State ───
    IERC20 public immutable usdt;

    /// @notice Wallet address for each leadership role
    address[6] private _roleAddresses;

    /// @notice Accumulated claimable USDT per role (indexed 0-5)
    uint256[6] public pendingAmount;

    /// @notice Accumulated bonus USDT (distributed by DAO admin)
    uint256 public bonusPending;

    /// @notice Cumulative USDT received by this contract
    uint256 public totalReceived;

    // ─── Events ───
    event USDTReceived(uint256 amount);
    event Claimed(uint256 indexed roleIndex, address indexed roleHolder, uint256 amount);
    event BonusDistributed(address indexed recipient, uint256 amount);
    event RoleAddressUpdated(uint256 indexed roleIndex, address indexed oldAddress, address indexed newAddress);

    // ─── Constructor ───

    /// @param _usdt USDT token address (6 decimals on BSC)
    /// @param roleAddresses Array of 6 leadership wallet addresses [Founder, Architect, CTO, SocialMedia, GlobalTraining, TechTeam]
    /// @param admin Address to receive DEFAULT_ADMIN_ROLE
    constructor(
        address _usdt,
        address[6] memory roleAddresses,
        address admin
    ) {
        require(_usdt != address(0), "ManagementPool: zero usdt");
        require(admin != address(0), "ManagementPool: zero admin");

        usdt = IERC20(_usdt);

        for (uint256 i = 0; i < ROLE_COUNT; i++) {
            require(roleAddresses[i] != address(0), "ManagementPool: zero role address");
            _roleAddresses[i] = roleAddresses[i];
        }

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ─── Core: Receive & Split ───

    /// @notice Called by RevenueRouter to deposit USDT and split to 7 pools
    /// @dev Pulls USDT from caller. Requires DISTRIBUTOR_ROLE.
    /// @param amount Total USDT to deposit (6 decimals)
    function receiveUSDT(uint256 amount) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        require(amount > 0, "ManagementPool: zero amount");

        usdt.safeTransferFrom(msg.sender, address(this), amount);
        totalReceived += amount;

        // Accumulate per role
        for (uint256 i = 0; i < ROLE_COUNT; i++) {
            pendingAmount[i] += (amount * _roleBps[i]) / 10000;
        }

        // Accumulate bonus pool
        bonusPending += (amount * BONUS_BPS) / 10000;

        emit USDTReceived(amount);
    }

    // ─── Claim: Role Holder Self-Claims ───

    /// @notice Role holder claims their accumulated USDT
    /// @param roleIndex Index of the role (0-5)
    function claim(uint256 roleIndex) external nonReentrant {
        require(roleIndex < ROLE_COUNT, "ManagementPool: invalid role");
        require(msg.sender == _roleAddresses[roleIndex], "ManagementPool: not role holder");

        uint256 amount = pendingAmount[roleIndex];
        require(amount > 0, "ManagementPool: nothing to claim");

        pendingAmount[roleIndex] = 0;
        usdt.safeTransfer(msg.sender, amount);

        emit Claimed(roleIndex, msg.sender, amount);
    }

    // ─── Bonus Pool: DAO-Controlled Distribution ───

    /// @notice Admin distributes bonus pool USDT to any address (DAO-controlled)
    /// @param recipient Address to receive the bonus
    /// @param amount Amount of USDT to distribute
    function distributeBonus(address recipient, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(recipient != address(0), "ManagementPool: zero recipient");
        require(amount > 0, "ManagementPool: zero amount");
        require(amount <= bonusPending, "ManagementPool: exceeds bonus pending");

        bonusPending -= amount;
        usdt.safeTransfer(recipient, amount);

        emit BonusDistributed(recipient, amount);
    }

    // ─── Admin: Update Role Addresses ───

    /// @notice Admin updates the wallet address for a leadership role
    /// @dev Pending amounts carry over to the new address
    /// @param roleIndex Index of the role (0-5)
    /// @param newAddress New wallet address for the role
    function setRoleAddress(uint256 roleIndex, address newAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(roleIndex < ROLE_COUNT, "ManagementPool: invalid role");
        require(newAddress != address(0), "ManagementPool: zero address");

        address oldAddress = _roleAddresses[roleIndex];
        _roleAddresses[roleIndex] = newAddress;

        emit RoleAddressUpdated(roleIndex, oldAddress, newAddress);
    }

    // ─── View Functions ───

    /// @notice Get the wallet address for a leadership role
    /// @param roleIndex Index of the role (0-5)
    function getRoleAddress(uint256 roleIndex) external view returns (address) {
        require(roleIndex < ROLE_COUNT, "ManagementPool: invalid role");
        return _roleAddresses[roleIndex];
    }

    /// @notice Get the BPS allocation for a leadership role
    /// @param roleIndex Index of the role (0-5)
    function getRoleBps(uint256 roleIndex) external view returns (uint256) {
        require(roleIndex < ROLE_COUNT, "ManagementPool: invalid role");
        return _roleBps[roleIndex];
    }
}
