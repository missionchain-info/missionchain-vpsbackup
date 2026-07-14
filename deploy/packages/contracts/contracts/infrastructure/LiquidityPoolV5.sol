// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LiquidityPool v5 — closed-loop USDT/MIC stabilizer
/// @notice Phase 2c redesign:
///   - 31.5M MIC initial allocation (vs v4's 105M; the other 73.5M moved to ListingReserveVault).
///   - USDT received from RevenueRouter / SeedBudget — NEVER withdrawable as USDT (closed-loop).
///   - Phase 2 (later): swap USDT ↔ MIC inside this pool to stabilize price.
///   - Existing swapAndBurnMIC for MICE flow KEPT.
///   - withdrawUSDT REMOVED (closed-loop principle: USDT only flows in or via swap).
///   - withdrawMICForCEX REMOVED (DEX/CEX listing handled by ListingReserveVault).
///
/// @dev Production: admin = DAOGovernor with timelock. On testnet: deployer.
contract LiquidityPoolV5 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 public constant DEPOSITOR_ROLE   = keccak256("DEPOSITOR_ROLE");
    bytes32 public constant BURN_CALLER_ROLE = keccak256("BURN_CALLER_ROLE");
    bytes32 public constant RATE_SETTER_ROLE = keccak256("RATE_SETTER_ROLE");

    IERC20 public immutable usdt;
    ERC20Burnable public immutable mic;

    uint256 public micPerUsdtRate;
    uint256 public totalUsdtForBurn;
    uint256 public totalMicBurned;
    uint256 public totalUSDTReceived;
    uint256 public totalMICDeposited;

    event USDTReceived(address indexed from, uint256 amount);
    event MICDeposited(address indexed from, uint256 amount);
    event MicBurnRateUpdated(uint256 oldRate, uint256 newRate);
    event SwappedAndBurned(address indexed from, uint256 usdtAmount, uint256 micBurned);

    constructor(address _usdt, address _mic, address admin) {
        require(_usdt != address(0), "LP5: zero usdt");
        require(_mic != address(0), "LP5: zero mic");
        require(admin != address(0), "LP5: zero admin");
        usdt = IERC20(_usdt);
        mic  = ERC20Burnable(_mic);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(RATE_SETTER_ROLE, admin);
    }

    // ─── Receive USDT (closed-loop) ─────────────────────────────────────

    /// @notice DISTRIBUTOR_ROLE caller pulls USDT into pool. No exit path —
    ///         USDT can only be consumed via swapAndBurnMIC or future Phase 2 swaps.
    function receiveAndDistribute(uint256 amount) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        require(amount > 0, "LP5: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        totalUSDTReceived += amount;
        emit USDTReceived(msg.sender, amount);
    }

    // ─── Reserved Staking — MIC deposit ─────────────────────────────────

    function depositMIC(uint256 amount) external onlyRole(DEPOSITOR_ROLE) nonReentrant {
        require(amount > 0, "LP5: zero amount");
        IERC20(address(mic)).safeTransferFrom(msg.sender, address(this), amount);
        totalMICDeposited += amount;
        emit MICDeposited(msg.sender, amount);
    }

    // ─── Swap & Burn (MICE deflation) ───────────────────────────────────

    function setMicBurnRate(uint256 newRate) external onlyRole(RATE_SETTER_ROLE) {
        require(newRate > 0, "LP5: zero rate");
        emit MicBurnRateUpdated(micPerUsdtRate, newRate);
        micPerUsdtRate = newRate;
    }

    function swapAndBurnMIC(uint256 usdtAmount) external onlyRole(BURN_CALLER_ROLE) nonReentrant {
        require(usdtAmount > 0, "LP5: zero amount");
        require(micPerUsdtRate > 0, "LP5: rate not set");

        usdt.safeTransferFrom(msg.sender, address(this), usdtAmount);

        uint256 micAmount = (usdtAmount * micPerUsdtRate) / 1_000_000;
        require(micAmount > 0, "LP5: zero MIC computed");
        require(mic.balanceOf(address(this)) >= micAmount, "LP5: insufficient MIC");

        mic.burn(micAmount);

        totalUSDTReceived += usdtAmount;
        totalUsdtForBurn  += usdtAmount;
        totalMicBurned    += micAmount;

        emit SwappedAndBurned(msg.sender, usdtAmount, micAmount);
    }

    // ─── Phase 2 STUBS (closed-loop bidirectional swap) ─────────────────

    /// @notice Reserved for Phase 2 stabilizer: swap USDT → MIC (held in pool).
    /// @dev Reverts in Phase 1. Activation requires DAO-approved upgrade.
    function swapUsdtToMic(uint256 /* usdtAmount */) external pure {
        revert("LP5: phase 2 not enabled");
    }

    /// @notice Reserved for Phase 2 stabilizer: swap MIC → USDT (held in pool).
    function swapMicToUsdt(uint256 /* micAmount */) external pure {
        revert("LP5: phase 2 not enabled");
    }

    // ─── Views ──────────────────────────────────────────────────────────

    function usdtBalance() public view returns (uint256) { return usdt.balanceOf(address(this)); }
    function micBalance() public view returns (uint256) { return mic.balanceOf(address(this)); }
    function previewBurn(uint256 usdtAmount) external view returns (uint256) {
        if (micPerUsdtRate == 0) return 0;
        return (usdtAmount * micPerUsdtRate) / 1_000_000;
    }
}
