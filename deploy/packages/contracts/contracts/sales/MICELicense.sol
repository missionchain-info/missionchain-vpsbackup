// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IReferralRegistry2 {
    function setReferrer(address user, address referrer) external;
    /// @dev Pulls (F1_BPS + F2_BPS)% of usdtAmount from msg.sender and pays F1/F2.
    function distributeReferral(address buyer, uint256 usdtAmount) external;
    function referrerOf(address user) external view returns (address);
    function F1_BPS() external view returns (uint256);
    function F2_BPS() external view returns (uint256);
}

interface IRevenueRouter2 {
    /// @dev Pulls `amount` USDT from msg.sender and splits across 5 pools.
    function receiveAndDistribute(uint256 amount) external;
}

/// @title MICELicense — ERC-1155 Mining License (5-Round Fixed Pricing)
/// @notice 100,000 max supply. 5 rounds × 20,000 licenses each.
///         Round prices: $100 / $200 / $300 / $400 / $500.
///         Each purchase requires:
///           50% of price in MIC — burned immediately.
///           50% of price in USDT — distributed via ReferralRegistry + RevenueRouter.
///         Referral: F1 7% + F2 3% of USDT portion (same as PreSale).
///         License duration: 360 days. Expired licenses can be recycled (slot reuse).
contract MICELicense is ERC1155, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────

    uint256 public constant MAX_SUPPLY = 100_000;
    uint256 public constant PER_ROUND  = 20_000;
    uint256 public constant DURATION   = 360 days;
    uint256 public constant NUM_ROUNDS = 5;

    // Referral BPS — mirrors ReferralRegistry (spec: F1 7%, F2 3%)
    uint256 public constant F1_BPS = 700;
    uint256 public constant F2_BPS = 300;

    // ─────────────────────────────────────────────────────────
    // State — contracts
    // ─────────────────────────────────────────────────────────

    IERC20             public immutable usdt;
    ERC20Burnable      public immutable micToken;
    IReferralRegistry2 public immutable referralRegistry;
    IRevenueRouter2    public immutable revenueRouter;

    // ─────────────────────────────────────────────────────────
    // State — pricing
    // ─────────────────────────────────────────────────────────

    /// @notice Fixed MIC price in USDT (6-decimal units).
    ///         e.g. 10000 = $0.01/MIC (listing price used for Phase 1 testnet).
    ///         Used to convert the 50% USDT half into a MIC burn amount.
    uint256 public micPriceUSDT;

    // ─────────────────────────────────────────────────────────
    // State — supply
    // ─────────────────────────────────────────────────────────

    /// @notice Total licenses ever minted (monotonically increasing for new IDs).
    uint256 public totalMinted;

    /// @notice Recycled license IDs available for re-sale.
    uint256[] private _recycledIds;

    // ─────────────────────────────────────────────────────────
    // State — license data
    // ─────────────────────────────────────────────────────────

    struct LicenseInfo {
        address owner;
        uint256 mintTime;
        uint256 expiryTime;
    }

    /// @notice licenseId → LicenseInfo
    mapping(uint256 => LicenseInfo) public licenses;

    /// @notice owner → list of their license IDs
    mapping(address => uint256[]) private _userLicenses;

    // ─────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────

    event LicensePurchased(
        address indexed buyer,
        uint256 indexed licenseId,
        uint256 price
    );
    event LicenseRecycled(uint256 indexed licenseId);
    event MicPriceUpdated(uint256 oldPrice, uint256 newPrice);

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    /// @param _usdt              USDT token (6 decimals on BSC)
    /// @param _micToken          MIC token — must implement ERC20Burnable
    /// @param _referralRegistry  ReferralRegistry for F1/F2 USDT commissions
    /// @param _revenueRouter     RevenueRouter — receives net USDT after referral
    /// @param admin              Address granted DEFAULT_ADMIN_ROLE
    /// @param _micPriceUSDT      MIC price in USDT units (e.g. 10000 = $0.01/MIC)
    constructor(
        address _usdt,
        address _micToken,
        address _referralRegistry,
        address _revenueRouter,
        address admin,
        uint256 _micPriceUSDT
    ) ERC1155("") {
        require(_usdt             != address(0), "MICE: zero usdt");
        require(_micToken         != address(0), "MICE: zero mic");
        require(_referralRegistry != address(0), "MICE: zero referral");
        require(_revenueRouter    != address(0), "MICE: zero router");
        require(admin             != address(0), "MICE: zero admin");
        require(_micPriceUSDT     >  0,          "MICE: zero mic price");

        usdt             = IERC20(_usdt);
        micToken         = ERC20Burnable(_micToken);
        referralRegistry = IReferralRegistry2(_referralRegistry);
        revenueRouter    = IRevenueRouter2(_revenueRouter);
        micPriceUSDT     = _micPriceUSDT;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ─────────────────────────────────────────────────────────
    // External — Purchase (with optional referrer)
    // ─────────────────────────────────────────────────────────

    /// @notice Purchase `quantity` mining licenses with an optional referrer.
    ///         Caller must have approved MIC and USDT for this contract.
    ///         If `referrer` is non-zero and the caller has no referrer yet, sets it.
    /// @param quantity  Number of licenses to purchase (must be ≥ 1)
    /// @param referrer  Optional referrer address (use address(0) for none)
    function buyLicense(uint256 quantity, address referrer) external nonReentrant {
        _buyLicenses(quantity, referrer);
    }

    /// @notice Purchase `quantity` mining licenses (no referrer).
    ///         Caller must have approved MIC and USDT for this contract.
    function buyLicense(uint256 quantity) external nonReentrant {
        _buyLicenses(quantity, address(0));
    }

    // ─────────────────────────────────────────────────────────
    // External — Round & price queries
    // ─────────────────────────────────────────────────────────

    /// @notice Returns the current round (1–5) based on totalMinted.
    function getCurrentRound() public view returns (uint256) {
        return _roundForToken(totalMinted);
    }

    /// @notice Returns the USDT price for the current round (6 decimals).
    function getCurrentPrice() public view returns (uint256) {
        return getPriceForRound(getCurrentRound());
    }

    /// @notice Returns the round (1–5) for a given 0-based token index.
    function getRoundForToken(uint256 tokenIndex) external pure returns (uint256) {
        return _roundForToken(tokenIndex);
    }

    /// @notice Returns the USDT price (6 decimals) for a given round (1–5).
    function getPriceForRound(uint256 round) public pure returns (uint256) {
        require(round >= 1 && round <= NUM_ROUNDS, "MICE: invalid round");
        if (round == 1) return 100 * 1_000_000;
        if (round == 2) return 200 * 1_000_000;
        if (round == 3) return 300 * 1_000_000;
        if (round == 4) return 400 * 1_000_000;
        return              500 * 1_000_000;
    }

    // ─────────────────────────────────────────────────────────
    // External — License status
    // ─────────────────────────────────────────────────────────

    /// @notice Returns true if the license exists and has not expired.
    function isActive(uint256 licenseId) external view returns (bool) {
        LicenseInfo storage lic = licenses[licenseId];
        if (lic.owner == address(0)) return false;
        return block.timestamp < lic.expiryTime;
    }

    /// @notice Returns all license IDs for a user.
    function getUserLicenses(address user) external view returns (uint256[] memory) {
        return _userLicenses[user];
    }

    // ─────────────────────────────────────────────────────────
    // External — Slot recycling
    // ─────────────────────────────────────────────────────────

    /// @notice Mark an expired license for recycling (adds its ID to the free-list).
    ///         Anyone can call. The recycled ID will be re-used for the next buyer.
    function recycleLicense(uint256 licenseId) external {
        LicenseInfo storage lic = licenses[licenseId];
        require(lic.owner != address(0), "MICE: license not found");
        require(block.timestamp >= lic.expiryTime, "MICE: license still active");

        lic.owner = address(0); // invalidate slot
        _recycledIds.push(licenseId);

        emit LicenseRecycled(licenseId);
    }

    /// @notice Number of recycled slots available for reuse.
    function recycledCount() external view returns (uint256) {
        return _recycledIds.length;
    }

    // ─────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────

    /// @notice Update the fixed MIC price used for burn calculations.
    function setMicPriceUSDT(uint256 newPrice) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newPrice > 0, "MICE: zero price");
        uint256 old = micPriceUSDT;
        micPriceUSDT = newPrice;
        emit MicPriceUpdated(old, newPrice);
    }

    // ─────────────────────────────────────────────────────────
    // Internal — Core purchase logic
    // ─────────────────────────────────────────────────────────

    /// @dev Shared purchase logic for both buyLicense overloads.
    ///
    ///  Flow per batch of `quantity` licenses:
    ///  1. Validate inputs and supply cap.
    ///  2. Optionally register referrer (one-time, immutable).
    ///  3. Price entire batch at the round of the FIRST license being minted.
    ///  4. Pull MIC = usdtHalf * 1e12 / micPriceUSDT from buyer, burn it.
    ///  5. Pull USDT half from buyer.
    ///  6. If buyer has a referrer: send (F1+F2)% to ReferralRegistry which
    ///     pays F1/F2; the remaining net goes to RevenueRouter.
    ///  7. Mint ERC-1155 license tokens (reuse recycled IDs first).
    function _buyLicenses(uint256 quantity, address referrer) private {
        require(quantity > 0, "MICE: zero quantity");
        require(totalMinted + quantity <= MAX_SUPPLY, "MICE: exceeds max supply");

        // ── (2) Register referrer (if provided and not yet set) ──────────────
        if (referrer != address(0)) {
            try referralRegistry.setReferrer(msg.sender, referrer) {} catch {}
        }

        // ── (3) Determine price (round of the first license in this batch) ──
        uint256 batchRound       = _roundForToken(totalMinted);
        uint256 pricePerLicense  = getPriceForRound(batchRound);
        uint256 totalUsdtHalf    = (pricePerLicense / 2) * quantity; // 50% × qty

        // ── (4) Pull MIC and burn ────────────────────────────────────────────
        uint256 micBurnAmount = _calcMicBurn(totalUsdtHalf);
        IERC20(address(micToken)).safeTransferFrom(msg.sender, address(this), micBurnAmount);
        micToken.burn(micBurnAmount);

        // ── (5) Pull USDT half ───────────────────────────────────────────────
        usdt.safeTransferFrom(msg.sender, address(this), totalUsdtHalf);

        // ── (6) Referral + RevenueRouter routing ─────────────────────────────
        uint256 netUsdt = totalUsdtHalf;

        address f1 = referralRegistry.referrerOf(msg.sender);
        if (f1 != address(0)) {
            // referralRegistry.distributeReferral pulls (F1+F2)% from us via safeTransferFrom.
            uint256 refAmount = (totalUsdtHalf * (F1_BPS + F2_BPS)) / 10000;
            usdt.approve(address(referralRegistry), refAmount);
            referralRegistry.distributeReferral(msg.sender, totalUsdtHalf);
            netUsdt = totalUsdtHalf - refAmount;
        }

        // Net USDT → RevenueRouter (router pulls via safeTransferFrom)
        if (netUsdt > 0) {
            usdt.approve(address(revenueRouter), netUsdt);
            revenueRouter.receiveAndDistribute(netUsdt);
        }

        // ── (7) Mint licenses ────────────────────────────────────────────────
        for (uint256 i = 0; i < quantity; i++) {
            _mintOneLicense(msg.sender, pricePerLicense);
        }
    }

    // ─────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────

    /// @dev Returns round 1–5 for a 0-based token index.
    function _roundForToken(uint256 tokenIndex) private pure returns (uint256) {
        if (tokenIndex < PER_ROUND)     return 1;
        if (tokenIndex < 2 * PER_ROUND) return 2;
        if (tokenIndex < 3 * PER_ROUND) return 3;
        if (tokenIndex < 4 * PER_ROUND) return 4;
        return 5;
    }

    /// @dev Converts a USDT-denominated half-price into the MIC burn amount.
    ///      USDT is 6 decimals; MIC is 18 decimals.
    ///      micAmount = usdtHalf * 1e12 / micPriceUSDT
    ///
    ///      Example: usdtHalf = 50e6 ($50), micPriceUSDT = 10000 ($0.01/MIC)
    ///      → micAmount = 50e6 * 1e12 / 10000 = 5e15 = 5,000,000 MIC (18 dec)
    function _calcMicBurn(uint256 usdtHalf_) private view returns (uint256) {
        return (usdtHalf_ * 1e12) / micPriceUSDT;
    }

    /// @dev Mint one license. Reuse a recycled slot if available; otherwise use next new ID.
    function _mintOneLicense(address to, uint256 price) private {
        uint256 licenseId;

        if (_recycledIds.length > 0) {
            licenseId = _recycledIds[_recycledIds.length - 1];
            _recycledIds.pop();
        } else {
            licenseId = totalMinted;
            totalMinted++;
        }

        licenses[licenseId] = LicenseInfo({
            owner:      to,
            mintTime:   block.timestamp,
            expiryTime: block.timestamp + DURATION
        });
        _userLicenses[to].push(licenseId);

        _mint(to, licenseId, 1, "");

        emit LicensePurchased(to, licenseId, price);
    }

    // ─────────────────────────────────────────────────────────
    // Interface override
    // ─────────────────────────────────────────────────────────

    /// @dev Required override for ERC1155 + AccessControl.
    function supportsInterface(bytes4 interfaceId)
        public view override(ERC1155, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
