// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/ILockManager.sol";

interface IMFPNFT {
    function autoGrantFromSeed(address to, uint256 amount) external;
    function grantMintAllowance(address to, uint256 amount) external;
}

interface ILockManagerOld {
    function createScheduleWithStart(
        address beneficiary,
        uint256 totalAmount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 cliffUnlockBps,
        uint256 monthlyUnlockBps
    ) external;
}

/// @title SeedSale v5 — wired to SeedBudgetV5 (Phase 2d redeploy May 2)
/// @notice Identical sale logic to v4 but constructor accepts SeedBudgetV5 address.
///         v4 SeedSale orphaned (immutable seedBudget linked to v4 SeedBudget which had
///         buggy 50/50 split + Audit slot). v5 routes 100% USDT to SeedBudgetV5 which
///         splits into 5 pools per anh's spec (20+20+10+40+10).
///         SUPER_ADMIN role naming removed per top-tier-hidden directive.
contract SeedSaleV5 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────

    /// @notice Role retained for analytics whitelist tracking (not enforced in buyPackage)
    bytes32 public constant WHITELISTER_ROLE = keccak256("WHITELISTER_ROLE");

    /// @notice GRANTER_ROLE — multi-admin gate for adminGrantOldInvestor (no on-chain cooldown).
    ///         Constructor grants this to the deployer admin; deployer can grant to
    ///         additional ADMIN wallets via standard AccessControl.
    bytes32 public constant GRANTER_ROLE = keccak256("GRANTER_ROLE");

    // ─── Immutables ───────────────────────────────────────────────────────────

    IERC20      public immutable usdt;
    IERC20      public immutable micToken;
    ILockManager public immutable lockManager;
    IMFPNFT     public immutable mfpNFT;
    address     public immutable seedBudget;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant ALLOCATION = 152_500_000 ether;
    uint256 public constant OLD_INVESTORS_ALLOCATION = 75_000_000 ether;
    uint256 private constant CLIFF_DURATION = 180 days;
    uint256 private constant CLIFF_UNLOCK_BPS = 1000;
    uint256 private constant MONTHLY_UNLOCK_BPS = 250;

    // ─── State ────────────────────────────────────────────────────────────────

    uint256 public totalSold;
    uint256 public oldInvestorsGranted;
    bool public active;
    mapping(address => bool) public whitelisted;

    // ─── Packages ─────────────────────────────────────────────────────────────

    struct Package {
        uint256 priceUsdt;
        uint256 micAmount;
        uint256 nftCount;
    }

    Package[4] public packages;

    // ─── Events ───────────────────────────────────────────────────────────────

    event SeedPurchase(
        address indexed buyer,
        uint256 indexed packageIndex,
        uint256 priceUsdt,
        uint256 micAmount,
        uint256 nftCount
    );
    event WhitelistUpdated(address indexed user, bool status);
    event SaleActivated(bool active);
    event OldInvestorGranted(
        address indexed recipient,
        address indexed admin,
        uint256 micAmount,
        uint256 mfpCount,
        uint256 startTime
    );

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _usdt         USDT token address (6 decimals)
    /// @param _micToken     MIC token address (18 decimals)
    /// @param _lockManager  LockManager contract (SCHEDULE_CREATOR role granted externally)
    /// @param _mfpNFT       MFPNFT contract (autoGrantFromSeed allowed externally)
    /// @param _seedBudget   SeedBudgetV5 contract — receives 100% USDT
    /// @param admin         Granted DEFAULT_ADMIN_ROLE + WHITELISTER_ROLE + GRANTER_ROLE
    /// @param _initialOldInvestorsGranted Carry over from v4 (e.g. 6_000_000 ether)
    constructor(
        address _usdt,
        address _micToken,
        address _lockManager,
        address _mfpNFT,
        address _seedBudget,
        address admin,
        uint256 _initialOldInvestorsGranted
    ) {
        require(_usdt        != address(0), "Seed: zero usdt");
        require(_micToken    != address(0), "Seed: zero micToken");
        require(_lockManager != address(0), "Seed: zero lockManager");
        require(_mfpNFT      != address(0), "Seed: zero mfpNFT");
        require(_seedBudget  != address(0), "Seed: zero seedBudget");
        require(admin        != address(0), "Seed: zero admin");
        require(_initialOldInvestorsGranted <= OLD_INVESTORS_ALLOCATION, "Seed: seed exceeds pool");

        usdt        = IERC20(_usdt);
        micToken    = IERC20(_micToken);
        lockManager = ILockManager(_lockManager);
        mfpNFT      = IMFPNFT(_mfpNFT);
        seedBudget  = _seedBudget;

        oldInvestorsGranted = _initialOldInvestorsGranted;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(WHITELISTER_ROLE,   admin);
        _grantRole(GRANTER_ROLE,       admin);

        // Whitepaper Apr 22 canonical SEED package design
        packages[0] = Package(1_000e6,  400_000 ether,   1);
        packages[1] = Package(2_500e6,  1_000_000 ether, 3);
        packages[2] = Package(5_000e6,  2_000_000 ether, 8);
        packages[3] = Package(10_000e6, 4_000_000 ether, 20);
    }

    // ─── Purchase ─────────────────────────────────────────────────────────────

    function buyPackage(uint256 packageIndex) external nonReentrant {
        require(active,                       "Seed: sale not active");
        require(packageIndex < 4,             "Seed: invalid package");

        Package memory pkg = packages[packageIndex];
        require(totalSold + pkg.micAmount <= ALLOCATION, "Seed: allocation exhausted");

        totalSold += pkg.micAmount;

        // 1. Pull USDT from buyer
        usdt.safeTransferFrom(msg.sender, address(this), pkg.priceUsdt);

        // 2. Forward 100% USDT to SeedBudgetV5
        usdt.forceApprove(seedBudget, pkg.priceUsdt);
        ISeedBudget(seedBudget).receiveAndDistribute(pkg.priceUsdt);

        // 3. Transfer MIC directly to buyer (Hybrid Token-Level Lock)
        micToken.safeTransfer(msg.sender, pkg.micAmount);

        // 4. Create vesting schedule
        lockManager.createSchedule(
            msg.sender,
            pkg.micAmount,
            CLIFF_DURATION,
            CLIFF_UNLOCK_BPS,
            MONTHLY_UNLOCK_BPS
        );

        // 5. Grant MFP-NFT mint allowance
        mfpNFT.autoGrantFromSeed(msg.sender, pkg.nftCount);

        emit SeedPurchase(msg.sender, packageIndex, pkg.priceUsdt, pkg.micAmount, pkg.nftCount);
    }

    // ─── Old Investors Strategic Partner Grant (75M pool) ─────────────────────

    function adminGrantOldInvestor(
        address recipient,
        uint256 micAmount,
        uint256 startTime
    ) external onlyRole(GRANTER_ROLE) nonReentrant {
        require(recipient != address(0), "Seed: zero recipient");
        require(micAmount > 0, "Seed: zero amount");
        require(startTime > 0, "Seed: zero startTime");
        require(
            oldInvestorsGranted + micAmount <= OLD_INVESTORS_ALLOCATION,
            "Seed: Old Investors pool exhausted"
        );

        oldInvestorsGranted += micAmount;

        micToken.safeTransfer(recipient, micAmount);

        ILockManagerOld(address(lockManager)).createScheduleWithStart(
            recipient,
            micAmount,
            startTime,
            CLIFF_DURATION,
            CLIFF_UNLOCK_BPS,
            MONTHLY_UNLOCK_BPS
        );

        emit OldInvestorGranted(recipient, msg.sender, micAmount, 0, startTime);
    }

    function oldInvestorsRemaining() external view returns (uint256) {
        return OLD_INVESTORS_ALLOCATION - oldInvestorsGranted;
    }

    // ─── Whitelist (analytics only, not enforced in buyPackage) ───────────────

    function addToWhitelist(address[] calldata users) external onlyRole(WHITELISTER_ROLE) {
        for (uint256 i = 0; i < users.length; i++) {
            whitelisted[users[i]] = true;
            emit WhitelistUpdated(users[i], true);
        }
    }

    function removeFromWhitelist(address[] calldata users) external onlyRole(WHITELISTER_ROLE) {
        for (uint256 i = 0; i < users.length; i++) {
            whitelisted[users[i]] = false;
            emit WhitelistUpdated(users[i], false);
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setActive(bool _active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        active = _active;
        emit SaleActivated(_active);
    }
}

interface ISeedBudget {
    function receiveAndDistribute(uint256 amount) external;
}
