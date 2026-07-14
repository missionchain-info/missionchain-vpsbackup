// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/ILockManager.sol";

interface IMFPNFT {
    function mintBatch(address to, uint256 amount) external;
}

/// @title SeedSale — SEED Round at $0.0025/MIC, NO referral, KYC whitelist
/// @notice 3.25% of total supply = 227.5M MIC allocated.
///         Packages bundle MFP-NFTs (20/60/150/350 per tier).
///         100% USDT forwarded to SeedBudget via receiveAndDistribute().
///         MIC transferred directly to buyer wallet (Hybrid Token-Level Lock).
///         LockManager.createSchedule() enforces 6-month cliff, 10% unlock, 2.5%/month.
contract SeedSale is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────

    /// @notice Role for adding/removing KYC-whitelisted buyers
    bytes32 public constant WHITELISTER_ROLE = keccak256("WHITELISTER_ROLE");

    // ─── Immutables ───────────────────────────────────────────────────────────

    IERC20      public immutable usdt;
    IERC20      public immutable micToken;
    ILockManager public immutable lockManager;
    IMFPNFT     public immutable mfpNFT;
    address     public immutable seedBudget;

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Total MIC allocation for SEED round (3.25% of 7B = 227.5M MIC)
    uint256 public constant ALLOCATION = 227_500_000 ether;

    /// @notice Vesting: 6-month cliff (180 days = 15552000 seconds)
    uint256 private constant CLIFF_DURATION = 180 days;

    /// @notice Cliff unlock: 10% (1000 BPS)
    uint256 private constant CLIFF_UNLOCK_BPS = 1000;

    /// @notice Monthly unlock after cliff: 2.5% (250 BPS)
    uint256 private constant MONTHLY_UNLOCK_BPS = 250;

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice Total MIC sold so far
    uint256 public totalSold;

    /// @notice Whether the sale is accepting purchases
    bool public active;

    /// @notice KYC whitelist
    mapping(address => bool) public whitelisted;

    // ─── Packages ─────────────────────────────────────────────────────────────

    struct Package {
        uint256 priceUsdt;  // USDT amount (6 decimals)
        uint256 micAmount;  // MIC amount (18 decimals)
        uint256 nftCount;   // Number of MFP-NFTs bundled
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

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _usdt         USDT token address (6 decimals)
    /// @param _micToken     MIC token address (18 decimals)
    /// @param _lockManager  LockManager contract (SCHEDULE_CREATOR_ROLE granted externally)
    /// @param _mfpNFT       MFPNFT contract (MINTER_ROLE granted externally)
    /// @param _seedBudget   SeedBudget contract — receives 100% USDT
    /// @param admin         Granted DEFAULT_ADMIN_ROLE + WHITELISTER_ROLE
    constructor(
        address _usdt,
        address _micToken,
        address _lockManager,
        address _mfpNFT,
        address _seedBudget,
        address admin
    ) {
        require(_usdt        != address(0), "Seed: zero usdt");
        require(_micToken    != address(0), "Seed: zero micToken");
        require(_lockManager != address(0), "Seed: zero lockManager");
        require(_mfpNFT      != address(0), "Seed: zero mfpNFT");
        require(_seedBudget  != address(0), "Seed: zero seedBudget");
        require(admin        != address(0), "Seed: zero admin");

        usdt        = IERC20(_usdt);
        micToken    = IERC20(_micToken);
        lockManager = ILockManager(_lockManager);
        mfpNFT      = IMFPNFT(_mfpNFT);
        seedBudget  = _seedBudget;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(WHITELISTER_ROLE,   admin);

        // Package 0: EARLY BIRD — $1,000 USDT / 400,000 MIC / 20 MFP-NFT
        packages[0] = Package(1_000e6,  400_000 ether,   20);
        // Package 1: FOUNDING PARTNER I — $2,500 USDT / 1,000,000 MIC / 60 MFP-NFT
        packages[1] = Package(2_500e6,  1_000_000 ether, 60);
        // Package 2: FOUNDING PARTNER II — $5,000 USDT / 2,000,000 MIC / 150 MFP-NFT
        packages[2] = Package(5_000e6,  2_000_000 ether, 150);
        // Package 3: FOUNDING PARTNER III — $10,000 USDT / 4,000,000 MIC / 350 MFP-NFT
        packages[3] = Package(10_000e6, 4_000_000 ether, 350);
    }

    // ─── Purchase ─────────────────────────────────────────────────────────────

    /// @notice Purchase a SEED package (MIC + MFP-NFT bundle)
    /// @param packageIndex 0=Early Bird, 1=FP-I, 2=FP-II, 3=FP-III
    function buyPackage(uint256 packageIndex) external nonReentrant {
        require(active,                       "Seed: sale not active");
        require(whitelisted[msg.sender],      "Seed: not whitelisted");
        require(packageIndex < 4,             "Seed: invalid package");

        Package memory pkg = packages[packageIndex];

        require(totalSold + pkg.micAmount <= ALLOCATION, "Seed: allocation exhausted");

        totalSold += pkg.micAmount;

        // 1. Pull USDT from buyer
        usdt.safeTransferFrom(msg.sender, address(this), pkg.priceUsdt);

        // 2. Forward 100% USDT to SeedBudget via receiveAndDistribute()
        //    SeedBudget pulls from this contract, so we approve it first.
        usdt.forceApprove(seedBudget, pkg.priceUsdt);
        ISeedBudget(seedBudget).receiveAndDistribute(pkg.priceUsdt);

        // 3. Transfer MIC directly to buyer (Hybrid Token-Level Lock)
        micToken.safeTransfer(msg.sender, pkg.micAmount);

        // 4. Create vesting schedule: 6-month cliff, 10% unlock, 2.5%/month
        lockManager.createSchedule(
            msg.sender,
            pkg.micAmount,
            CLIFF_DURATION,
            CLIFF_UNLOCK_BPS,
            MONTHLY_UNLOCK_BPS
        );

        // 5. Mint bundled MFP-NFTs
        mfpNFT.mintBatch(msg.sender, pkg.nftCount);

        emit SeedPurchase(msg.sender, packageIndex, pkg.priceUsdt, pkg.micAmount, pkg.nftCount);
    }

    // ─── Whitelist Management ─────────────────────────────────────────────────

    /// @notice Add addresses to the KYC whitelist
    function addToWhitelist(address[] calldata users)
        external
        onlyRole(WHITELISTER_ROLE)
    {
        for (uint256 i = 0; i < users.length; i++) {
            whitelisted[users[i]] = true;
            emit WhitelistUpdated(users[i], true);
        }
    }

    /// @notice Remove addresses from the KYC whitelist
    function removeFromWhitelist(address[] calldata users)
        external
        onlyRole(WHITELISTER_ROLE)
    {
        for (uint256 i = 0; i < users.length; i++) {
            whitelisted[users[i]] = false;
            emit WhitelistUpdated(users[i], false);
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Enable or disable purchasing
    function setActive(bool _active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        active = _active;
        emit SaleActivated(_active);
    }
}

/// @dev Minimal interface for SeedBudget.receiveAndDistribute()
interface ISeedBudget {
    function receiveAndDistribute(uint256 amount) external;
}
