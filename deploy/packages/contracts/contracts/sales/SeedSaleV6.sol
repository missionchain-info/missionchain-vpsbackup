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

interface ISeedBudget {
    function receiveAndDistribute(uint256 amount) external;
}

/// @title SeedSaleV6 — wired to SeedBudgetV5b (centralized vault)
/// @notice Identical sale logic to V5 but adds:
///   - rescueToken() — Owner can withdraw any ERC20 stuck in this contract
///     (lesson learned: previous SeedSale versions had no rescue, causing
///     orphaned MIC on each migration)
contract SeedSaleV6 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant WHITELISTER_ROLE = keccak256("WHITELISTER_ROLE");
    bytes32 public constant GRANTER_ROLE     = keccak256("GRANTER_ROLE");

    IERC20      public immutable usdt;
    IERC20      public immutable micToken;
    ILockManager public immutable lockManager;
    IMFPNFT     public immutable mfpNFT;
    address     public immutable seedBudget;

    uint256 public constant ALLOCATION = 152_500_000 ether;
    uint256 public constant OLD_INVESTORS_ALLOCATION = 75_000_000 ether;
    uint256 private constant CLIFF_DURATION = 180 days;
    uint256 private constant CLIFF_UNLOCK_BPS = 1000;
    uint256 private constant MONTHLY_UNLOCK_BPS = 250;

    uint256 public totalSold;
    uint256 public oldInvestorsGranted;
    bool public active;
    mapping(address => bool) public whitelisted;

    struct Package {
        uint256 priceUsdt;
        uint256 micAmount;
        uint256 nftCount;
    }
    Package[4] public packages;

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
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

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

        packages[0] = Package(1_000e6,  400_000 ether,   1);
        packages[1] = Package(2_500e6,  1_000_000 ether, 3);
        packages[2] = Package(5_000e6,  2_000_000 ether, 8);
        packages[3] = Package(10_000e6, 4_000_000 ether, 20);
    }

    function buyPackage(uint256 packageIndex) external nonReentrant {
        require(active, "Seed: sale not active");
        require(packageIndex < 4, "Seed: invalid package");

        Package memory pkg = packages[packageIndex];
        require(totalSold + pkg.micAmount <= ALLOCATION, "Seed: allocation exhausted");
        totalSold += pkg.micAmount;

        usdt.safeTransferFrom(msg.sender, address(this), pkg.priceUsdt);
        usdt.forceApprove(seedBudget, pkg.priceUsdt);
        ISeedBudget(seedBudget).receiveAndDistribute(pkg.priceUsdt);

        micToken.safeTransfer(msg.sender, pkg.micAmount);

        lockManager.createSchedule(
            msg.sender,
            pkg.micAmount,
            CLIFF_DURATION,
            CLIFF_UNLOCK_BPS,
            MONTHLY_UNLOCK_BPS
        );

        mfpNFT.autoGrantFromSeed(msg.sender, pkg.nftCount);

        emit SeedPurchase(msg.sender, packageIndex, pkg.priceUsdt, pkg.micAmount, pkg.nftCount);
    }

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

    function setActive(bool _active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        active = _active;
        emit SaleActivated(_active);
    }

    /// @notice Owner-only emergency rescue of stuck tokens (e.g. for migration).
    function rescueToken(address token, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(token != address(0), "Seed: zero token");
        require(to != address(0), "Seed: zero recipient");
        require(amount > 0, "Seed: zero amount");
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }
}
