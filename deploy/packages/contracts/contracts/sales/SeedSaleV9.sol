// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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

/// @title SeedSaleV9 — SEED round, 18-decimal pricing, whitelist enforced
///
/// @notice Third contract for the same round. The history matters, because each version
///         was replaced for a reason that is easy to reintroduce:
///
///         **`SeedSaleV7` `0xe4C1…0905` — halted 2026-08-08** (tx 0xc931ff25…72613a).
///         Package prices were written in 6 decimals against 18-decimal BSC-USD, so
///         package 3 sold 4,000,000 MIC and 20 MFP for 0.00000001 USDT. It also declared
///         a `whitelisted` mapping that `buyPackage` never read. `totalSold` was 0.
///
///         **`SeedSaleV8` `0xD855…5B50` — deployed 2026-08-08 15:55, never activated.**
///         Fixed the decimals, but was built during a short window when the round was to
///         be open to everyone, so the whitelist machinery was removed outright. Left with
///         `active = false` and superseded before it ever sold anything.
///
///         **This contract** carries the 18-decimal prices AND enforces the whitelist:
///         `buyPackage` reads it on the second line, before the package index is even
///         validated.
///
/// @dev    The gate is not bookkeeping — it is what keeps the two live rounds from
///         cannibalising each other. SEED sells MIC at $0.0025 and the Pre-Sale at
///         $0.005, so $1,000 buys 400,000 MIC here against 200,000 there. An open SEED at
///         half the price leaves nobody with a reason to buy the Pre-Sale, and the
///         315,000,000 MIC in `PreSale` `0xC4A6…BE23` would simply never move.
///
///         `whitelistRequired` starts **true** and every change emits an event.
///
/// @dev    SEED has NO referral — that belongs to Pre-Sale and MICE only.
contract SeedSaleV9 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant WHITELISTER_ROLE = keccak256("WHITELISTER_ROLE");
    bytes32 public constant GRANTER_ROLE     = keccak256("GRANTER_ROLE");

    IERC20       public immutable usdt;
    IERC20       public immutable micToken;
    ILockManager public immutable lockManager;
    IMFPNFT      public immutable mfpNFT;
    address      public immutable seedBudget;

    uint256 public constant ALLOCATION = 152_500_000 ether;
    uint256 public constant OLD_INVESTORS_ALLOCATION = 75_000_000 ether;
    uint256 private constant CLIFF_DURATION = 180 days;
    uint256 private constant CLIFF_UNLOCK_BPS = 1000;
    uint256 private constant MONTHLY_UNLOCK_BPS = 250;

    uint256 public totalSold;
    uint256 public oldInvestorsGranted;
    bool public active;

    /// @notice When true, only whitelisted addresses may buy. Starts true.
    bool public whitelistRequired;

    /// @notice Addresses cleared to buy the SEED round.
    mapping(address => bool) public whitelisted;

    /// @notice How many addresses are currently cleared — so the admin console can show
    ///         a count without replaying every event.
    uint256 public whitelistedCount;

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
    event WhitelistRequirementSet(bool required);
    event SaleActivated(bool active);
    event OldInvestorGranted(
        address indexed recipient,
        address indexed admin,
        uint256 micAmount,
        uint256 mfpCount,
        uint256 startTime
    );
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    /// @param _initialOldInvestorsGranted  Carried forward from the contract being
    ///        replaced, so the 75,000,000 Old Investors cap keeps counting from where it
    ///        left off instead of resetting and allowing a second full round of grants.
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

        // Package prices below are 18-decimal. Against a 6-decimal token every one of
        // them becomes a trillion times too large; against an 18-decimal token a
        // 6-decimal price list becomes free. Refuse rather than find out in production.
        require(IERC20Metadata(_usdt).decimals() == 18, "Seed: usdt must be 18 decimals");

        usdt        = IERC20(_usdt);
        micToken    = IERC20(_micToken);
        lockManager = ILockManager(_lockManager);
        mfpNFT      = IMFPNFT(_mfpNFT);
        seedBudget  = _seedBudget;

        oldInvestorsGranted = _initialOldInvestorsGranted;
        whitelistRequired   = true;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(WHITELISTER_ROLE,   admin);
        _grantRole(GRANTER_ROLE,       admin);

        //                price        MIC delivered      MFP
        packages[0] = Package( 1_000 ether,   400_000 ether,  1);
        packages[1] = Package( 2_500 ether, 1_000_000 ether,  3);
        packages[2] = Package( 5_000 ether, 2_000_000 ether,  8);
        packages[3] = Package(10_000 ether, 4_000_000 ether, 20);
    }

    function buyPackage(uint256 packageIndex) external nonReentrant {
        require(active, "Seed: sale not active");
        // V7's whole defect in one line: it had the mapping and never read it.
        require(!whitelistRequired || whitelisted[msg.sender], "Seed: not whitelisted");
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

    /// @notice MIC still owed by this contract: unsold allocation plus ungranted Old
    ///         Investors pool. The funding transfer should match this exactly.
    function micRequired() external view returns (uint256) {
        return (ALLOCATION - totalSold) + (OLD_INVESTORS_ALLOCATION - oldInvestorsGranted);
    }

    /// @notice Clear addresses to buy. Re-adding an address already on the list is a
    ///         no-op so a resubmitted batch cannot inflate the count.
    function addToWhitelist(address[] calldata users) external onlyRole(WHITELISTER_ROLE) {
        for (uint256 i = 0; i < users.length; i++) {
            address u = users[i];
            if (u == address(0) || whitelisted[u]) continue;
            whitelisted[u] = true;
            whitelistedCount++;
            emit WhitelistUpdated(u, true);
        }
    }

    function removeFromWhitelist(address[] calldata users) external onlyRole(WHITELISTER_ROLE) {
        for (uint256 i = 0; i < users.length; i++) {
            address u = users[i];
            if (!whitelisted[u]) continue;
            whitelisted[u] = false;
            whitelistedCount--;
            emit WhitelistUpdated(u, false);
        }
    }

    /// @notice Open the round to everyone, or close it back to the list.
    /// @dev    Opening it removes the only thing stopping buyers from taking MIC here at
    ///         half the Pre-Sale price. Deliberate act, and it is logged.
    function setWhitelistRequired(bool required) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistRequired = required;
        emit WhitelistRequirementSet(required);
    }

    /// @notice Whether this address can buy right now — one call for the DApp to gate on.
    function canBuy(address user) external view returns (bool) {
        return active && (!whitelistRequired || whitelisted[user]);
    }

    function setActive(bool _active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        active = _active;
        emit SaleActivated(_active);
    }

    /// @notice Owner-only rescue of stuck tokens, and the migration path out of this
    ///         contract if it is ever replaced in turn.
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
