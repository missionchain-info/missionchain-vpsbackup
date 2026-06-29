// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LiquidityPool — Phase 1 USDT Buffer + Locked MIC
/// @notice Phase 1 buffer contract that:
///   1. Holds 105M MIC (locked DEX/CEX listing allocation — sent at deploy by deployer)
///   2. Receives USDT from RevenueRouter (40% of net revenue) and SeedBudget (40% of SEED)
///   3. Receives MIC deposits from Reserved Staking admin (admin buys MIC from DEX, deposits here)
///
/// Phase 2 (deferred — NOT implemented here):
///   - SWAP functionality (PancakeSwap integration)
///   - AI Stabilizer
///   - Will be added later via upgrade or new contract
///
/// @dev Security:
///   - 105M MIC locked at deploy — only withdrawable via DAO structural vote (withdrawMICForCEX)
///   - USDT withdrawals require DAO 24h timelock (enforced by DAOGovernor — admin = DAOGovernor in prod)
///   - ReentrancyGuard on all transfer functions
///   - SafeERC20 for all token transfers
contract LiquidityPool is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ───

    /// @notice Granted to RevenueRouter and SeedBudget — they call receiveUSDT
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    /// @notice Granted to Reserved Staking admin — calls depositMIC
    bytes32 public constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");

    // ─── Tokens ───

    /// @notice USDT token (6 decimals on BSC)
    IERC20 public immutable usdt;

    /// @notice MIC token (18 decimals)
    IERC20 public immutable mic;

    // ─── Tracking ───

    /// @notice Cumulative USDT received from RevenueRouter / SeedBudget
    uint256 public totalUSDTReceived;

    /// @notice Cumulative MIC deposited by Reserved Staking admin (excludes locked 105M)
    uint256 public totalMICDeposited;

    // ─── Events ───

    event USDTReceived(address indexed from, uint256 amount);
    event MICDeposited(address indexed from, uint256 amount);
    event USDTWithdrawn(address indexed to, uint256 amount);
    event MICWithdrawnForCEX(address indexed to, uint256 amount);

    // ─── Constructor ───

    /// @param _usdt USDT token address (6 decimals)
    /// @param _mic MIC token address (18 decimals)
    /// @param admin Address to receive DEFAULT_ADMIN_ROLE (DAOGovernor in production)
    constructor(
        address _usdt,
        address _mic,
        address admin
    ) {
        require(_usdt != address(0), "LiquidityPool: zero usdt");
        require(_mic != address(0), "LiquidityPool: zero mic");
        require(admin != address(0), "LiquidityPool: zero admin");

        usdt = IERC20(_usdt);
        mic  = IERC20(_mic);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ─── Phase 1: Receive USDT ───

    /// @notice Called by RevenueRouter or SeedBudget to deposit USDT into the buffer.
    ///         Pulls USDT from the caller. Requires DISTRIBUTOR_ROLE.
    /// @param amount Amount of USDT (6 decimals) to pull and buffer
    function receiveUSDT(uint256 amount) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        require(amount > 0, "LiquidityPool: zero amount");

        usdt.safeTransferFrom(msg.sender, address(this), amount);
        totalUSDTReceived += amount;

        emit USDTReceived(msg.sender, amount);
    }

    // ─── Phase 1: Deposit MIC (Reserved Staking) ───

    /// @notice Called by Reserved Staking admin after buying MIC from DEX.
    ///         Pulls MIC from the caller into the buffer. Requires DEPOSITOR_ROLE.
    /// @param amount Amount of MIC (18 decimals) to pull into the contract
    function depositMIC(uint256 amount) external onlyRole(DEPOSITOR_ROLE) nonReentrant {
        require(amount > 0, "LiquidityPool: zero amount");

        mic.safeTransferFrom(msg.sender, address(this), amount);
        totalMICDeposited += amount;

        emit MICDeposited(msg.sender, amount);
    }

    // ─── Phase 1: DAO Withdrawals ───

    /// @notice DAO-only USDT withdrawal. In production, admin = DAOGovernor with 24h timelock.
    ///         Used for deploying USDT to liquidity pools or strategic purposes.
    /// @param to Recipient address
    /// @param amount Amount of USDT (6 decimals) to withdraw
    function withdrawUSDT(
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(to != address(0), "LiquidityPool: zero recipient");
        require(amount > 0, "LiquidityPool: zero amount");
        require(amount <= usdtBalance(), "LiquidityPool: insufficient USDT");

        usdt.safeTransfer(to, amount);

        emit USDTWithdrawn(to, amount);
    }

    /// @notice DAO structural vote to send MIC to CEX for listing.
    ///         In production, admin = DAOGovernor with 7d structural vote timelock.
    ///         This is the ONLY way to move the locked 105M MIC (DEX/CEX listing allocation).
    /// @param to Recipient address (CEX deposit address)
    /// @param amount Amount of MIC (18 decimals) to send
    function withdrawMICForCEX(
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(to != address(0), "LiquidityPool: zero recipient");
        require(amount > 0, "LiquidityPool: zero amount");
        require(amount <= micBalance(), "LiquidityPool: insufficient MIC");

        mic.safeTransfer(to, amount);

        emit MICWithdrawnForCEX(to, amount);
    }

    // ─── View Functions ───

    /// @notice Current USDT balance held in this contract
    function usdtBalance() public view returns (uint256) {
        return usdt.balanceOf(address(this));
    }

    /// @notice Current MIC balance held in this contract (locked 105M + any additional deposits)
    function micBalance() public view returns (uint256) {
        return mic.balanceOf(address(this));
    }
}
