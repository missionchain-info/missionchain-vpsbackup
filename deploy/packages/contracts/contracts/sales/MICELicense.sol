// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IReferralRegistry2 {
    function setReferrer(address user, address referrer) external;
    /// @dev Pays F1 7% / F2 3% of usdtAmount out of the registry's OWN balance (the router
    ///      deposits the Referral 10% slice there); unspent portion → Milestones & Incentives.
    function distributeReferral(address buyer, uint256 usdtAmount) external;
    function referrerOf(address user) external view returns (address);
    function F1_BPS() external view returns (uint256);
    function F2_BPS() external view returns (uint256);
}

interface IRevenueRouter2 {
    /// @dev Pulls `amount` USDT from msg.sender and splits it 6 ways on GROSS.
    function receiveAndDistribute(uint256 amount) external;
}

interface ILiquidityPoolV6 {
    /// @notice True once the pool holds MIC and has begun pricing. False means it quotes
    ///         nothing at all, rather than quoting zero as if MIC were worthless.
    function isSeeded() external view returns (bool);
    /// @notice USDT (18-dec) per 1e18 MIC, right now, from the pool's own reserves.
    function spotPrice() external view returns (uint256);
    /// @notice 7-day time-weighted average of the same quantity. Window is
    ///         min(7 days, pool age), so it is defined from the first block.
    function twap7d() external view returns (uint256);
}

/// @title MICELicense — ERC-1155 Mining License (5-Round Fixed Pricing)
/// @notice 100,000 max supply. 5 rounds × 20,000 licenses each.
///         Round prices: $100 / $200 / $300 / $400 / $500.
///         Each purchase requires:
///           50% of price in MIC — burned immediately.
///           50% of price in USDT — distributed via ReferralRegistry + RevenueRouter.
///         Referral: F1 7% + F2 3% of USDT portion (same as PreSale).
///         License duration: 360 days. Expired licenses can be recycled (slot reuse).
/**
 * @dev The mining pool's view of a licence's life. MICELicense is the authority on when a
 *      licence starts, ends and changes hands; the pool only mirrors those three events.
 */
interface IMiningPool {
    function onLicenceActivated(uint256 licenceId, address owner, uint256 expiryTime) external;
    function onLicenceEnded(uint256 licenceId, address owner) external;
    function onLicenceTransferred(uint256 licenceId, address from, address to) external;
}

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

    /// @notice Liquidity pool that publishes the MIC reference price. There is no
    ///         admin-set price anywhere in this contract: the burn amount is derived
    ///         from min(spot, 7-day TWAP) read from the pool at purchase time.
    ILiquidityPoolV6 public liquidityPool;

    /// @notice Reference price used only while the pool has never been seeded.
    ///
    /// @dev This is not a discretionary price. It is set once at deployment to the pool's
    ///      published opening price, and the pool's own first quote is arithmetically the
    ///      same number: spot is the virtual reserve over the MIC seed ($500,000 /
    ///      50,000,000 = $0.01), and `twap7d` on a pool of age zero returns spot. So the
    ///      last purchase before seeding and the first after it cost exactly the same,
    ///      leaving no step for anyone to trade against.
    ///
    ///      It is immutable, and it stops applying the instant the pool reports `isSeeded`.
    ///      Once the market exists, the market prices this — permanently and with no way
    ///      back. That boundary is what keeps this from becoming an admin-set price.
    uint256 public immutable bootstrapPrice;

    /// @notice Delay between purchase and activation. The 360-day term starts at
    ///         activation, not at purchase, so nobody loses days to this window.
    /// @notice Wait between buying and being allowed to activate.
    ///
    /// @dev Zero: a buyer activates whenever they choose. The delay existed to space
    ///      purchase from the start of the term, but the term already starts at
    ///      activation, so all it did was make someone wait to begin earning.
    uint256 public constant ACTIVATION_DELAY = 0;

    // ─────────────────────────────────────────────────────────
    // State — supply
    // ─────────────────────────────────────────────────────────

    /// @notice Total licenses ever minted (monotonically increasing for new IDs).
    uint256 public totalMinted;

    /// @notice Recycled license IDs available for re-sale.
    uint256[] private _recycledIds;

    /// @notice Licenses that have been activated and not yet recycled. This is what
    ///         EmissionController reads as the demand factor input. Kept as a counter
    ///         rather than derived from `totalMinted` so expired-but-unrecycled seats
    ///         cannot inflate it.
    uint256 public activeLicenses;

    // ─────────────────────────────────────────────────────────
    // State — license data
    // ─────────────────────────────────────────────────────────

    struct LicenseInfo {
        address owner;
        uint256 mintTime;
        /// @notice Set when the license is activated (>= mintTime + ACTIVATION_DELAY).
        ///         Zero means "purchased but not yet activated" — it earns nothing and
        ///         is not counted in `activeLicenses`.
        uint256 activatedAt;
        uint256 expiryTime;
        /// @notice USDT price (18-dec) actually paid for this license, i.e. the round price
        ///         at mint time. Recorded so reward weighting can be changed later without
        ///         redeploying; nothing reads it today (rewards are per-license, not per-USD).
        uint256 pricePaid;
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
    event LicenseActivated(uint256 indexed licenseId, address indexed owner, uint256 expiryTime);

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    /// @param _usdt              USDT token — must report 18 decimals (BSC-USD)
    /// @param _micToken          MIC token — must implement ERC20Burnable
    /// @param _referralRegistry  ReferralRegistry for F1/F2 USDT commissions
    /// @param _revenueRouter     RevenueRouter — receives net USDT after referral
    /// @param admin              Address granted DEFAULT_ADMIN_ROLE
    /// @param _liquidityPool     LiquidityPoolV6 — the only source of the MIC reference price
    constructor(
        address _usdt,
        address _micToken,
        address _referralRegistry,
        address _revenueRouter,
        address admin,
        address _liquidityPool,
        uint256 _bootstrapPrice
    ) ERC1155("") {
        // Round prices below are 18-decimal. Against a 6-decimal token they would be a
        // trillion times too large; the reverse sold licences for nothing. Refuse at
        // construction rather than discover it from a buyer.
        require(IERC20Metadata(_usdt).decimals() == 18, "MICE: usdt must be 18 decimals");
        require(_usdt             != address(0), "MICE: zero usdt");
        require(_micToken         != address(0), "MICE: zero mic");
        require(_referralRegistry != address(0), "MICE: zero referral");
        require(_revenueRouter    != address(0), "MICE: zero router");
        require(admin             != address(0), "MICE: zero admin");
        require(_liquidityPool    != address(0), "MICE: zero pool");
        // A zero bootstrap would price the MIC half at nothing for every sale made before
        // the pool exists — the entire burn, silently skipped.
        require(_bootstrapPrice   > 0,           "MICE: zero bootstrap price");

        usdt             = IERC20(_usdt);
        micToken         = ERC20Burnable(_micToken);
        referralRegistry = IReferralRegistry2(_referralRegistry);
        revenueRouter    = IRevenueRouter2(_revenueRouter);
        liquidityPool    = ILiquidityPoolV6(_liquidityPool);
        bootstrapPrice   = _bootstrapPrice;

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

    /// @notice Returns the USDT price for the current round (18 decimals).
    function getCurrentPrice() public view returns (uint256) {
        return getPriceForRound(getCurrentRound());
    }

    /// @notice Returns the round (1–5) for a given 0-based token index.
    function getRoundForToken(uint256 tokenIndex) external pure returns (uint256) {
        return _roundForToken(tokenIndex);
    }

    /// @notice Round price in USDT, 18 decimals.
    /// @dev These were written as `100 * 1_000_000` — $100 in 6 decimals. BSC-USD is 18,
    ///      so that asked for 0.0000000001 USDT and every licence in all five rounds
    ///      would have sold for nothing. The same mistake reached mainnet twice already:
    ///      `PreSale` before launch and `SeedSaleV7` after it. See "Decimals" in
    ///      deploy/CLAUDE.md.
    function getPriceForRound(uint256 round) public pure returns (uint256) {
        require(round >= 1 && round <= NUM_ROUNDS, "MICE: invalid round");
        if (round == 1) return 100 ether;
        if (round == 2) return 200 ether;
        if (round == 3) return 300 ether;
        if (round == 4) return 400 ether;
        return              500 ether;
    }

    // ─────────────────────────────────────────────────────────
    // External — License status
    // ─────────────────────────────────────────────────────────

    /// @notice Returns true if the license exists and has not expired.
    /// @notice What state a licence is in.
    ///
    /// @dev Published as an explicit value rather than left to be inferred. `EXPIRED` was
    ///      previously only visible as "owner is the zero address after someone recycled
    ///      it" — which conflates a licence whose term has ended with one whose slot has
    ///      been handed to the next buyer, and shows nothing at all in the window between.
    enum Status { NONE, PENDING, ACTIVE, EXPIRED, RECYCLED }

    /// @notice Status of a licence. EXPIRED is stamped the moment its term ends, whether
    ///         or not anybody has recycled the slot; an EXPIRED licence earns nothing.
    function statusOf(uint256 licenseId) public view returns (Status) {
        LicenseInfo storage lic = licenses[licenseId];
        if (lic.owner == address(0)) {
            return lic.mintTime == 0 ? Status.NONE : Status.RECYCLED;
        }
        if (lic.activatedAt == 0) return Status.PENDING;
        return block.timestamp < lic.expiryTime ? Status.ACTIVE : Status.EXPIRED;
    }

    /// @notice True once the term has run out. Earning stops here, exactly.
    function isExpired(uint256 licenseId) external view returns (bool) {
        return statusOf(licenseId) == Status.EXPIRED;
    }

    function isActive(uint256 licenseId) external view returns (bool) {
        LicenseInfo storage lic = licenses[licenseId];
        if (lic.owner == address(0)) return false;
        if (lic.activatedAt == 0) return false;          // bought, not yet activated
        return block.timestamp < lic.expiryTime;
    }

    /// @notice True once the activation delay has elapsed and the licence has not been
    ///         activated yet.
    function isActivatable(uint256 licenseId) public view returns (bool) {
        LicenseInfo storage lic = licenses[licenseId];
        return lic.owner != address(0)
            && lic.activatedAt == 0
            && block.timestamp >= lic.mintTime + ACTIVATION_DELAY;
    }

    /// @notice Start a licence's 360-day term. Callable by anyone, at any time after
    ///         purchase, so the DApp (or a keeper) can activate on the owner's behalf and
    ///         nobody is stranded by forgetting to call it.
    /// @dev    The term starts HERE, not at purchase — the delay costs the buyer nothing.
    ///         `activeLicenses` is what EmissionController reads, so a licence only
    ///         starts counting toward emission once it is genuinely mining.
    /// @notice The mining pool told about activation, expiry and transfer.
    ///
    /// @dev Settable rather than immutable, and skipped while unset. MICELicense is
    ///      deployed before the pool, and a licence must never become unactivatable
    ///      because the pool it reports to is broken or being replaced.
    IMiningPool public miningPool;

    event MiningPoolSet(address indexed pool);

    /// @notice Point the sale at a different price source.
    ///
    /// @dev Added because its absence is what forced this contract to be redeployed: the
    ///      pool address was fixed at construction, so changing anything about pricing
    ///      meant a new MICELicense, and `EmissionController.miceLicense` being immutable
    ///      meant a new EmissionController with it — including a fresh grant of MINTER_ROLE.
    ///      One missing setter cost the two most sensitive contracts in the system.
    function setLiquidityPool(address pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(pool != address(0), "MICE: zero pool");
        liquidityPool = ILiquidityPoolV6(pool);
        emit LiquidityPoolSet(pool);
    }

    event LiquidityPoolSet(address indexed pool);

    function setMiningPool(address pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        miningPool = IMiningPool(pool);
        emit MiningPoolSet(pool);
    }

    /// @notice Current holder of a licence. The mining pool reads this at claim time
    ///         rather than keeping its own copy of ownership.
    function ownerOfLicense(uint256 licenseId) external view returns (address) {
        return licenses[licenseId].owner;
    }

    function activate(uint256 licenseId) public {
        require(isActivatable(licenseId), "MICE: not activatable");
        LicenseInfo storage lic = licenses[licenseId];
        lic.activatedAt = block.timestamp;
        lic.expiryTime  = block.timestamp + DURATION;
        activeLicenses += 1;

        // Earning starts on this second, not at some shared daily boundary — activate at
        // 3pm and you are owed from 3pm.
        if (address(miningPool) != address(0)) {
            // The pool is given the expiry up front so it can stop the meter on the
            // second, instead of waiting for someone to notice the licence has ended.
            miningPool.onLicenceActivated(licenseId, lic.owner, lic.expiryTime);
        }

        emit LicenseActivated(licenseId, lic.owner, lic.expiryTime);
    }

    /// @notice Activate several licences in one transaction.
    function activateBatch(uint256[] calldata licenseIds) external {
        for (uint256 i = 0; i < licenseIds.length; i++) activate(licenseIds[i]);
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
    function recycleLicense(uint256 licenseId) public {
        LicenseInfo storage lic = licenses[licenseId];
        require(lic.owner != address(0), "MICE: license not found");
        require(lic.activatedAt != 0,    "MICE: never activated");
        require(block.timestamp >= lic.expiryTime, "MICE: license still active");

        address previousOwner = lic.owner;

        // Stop the meter and bank what this licence earned BEFORE the slot is wiped —
        // afterwards there is no owner left to credit.
        if (address(miningPool) != address(0)) {
            miningPool.onLicenceEnded(licenseId, previousOwner);
        }

        lic.owner = address(0); // invalidate slot
        _recycledIds.push(licenseId);
        activeLicenses -= 1;

        emit LicenseRecycled(licenseId);
    }

    /// @notice Recycle several expired licences at once. Buyers have a direct incentive
    ///         to call this: once 100,000 seats are minted, recycling is what frees a
    ///         seat for the next purchase.
    function recycleBatch(uint256[] calldata licenseIds) external {
        for (uint256 i = 0; i < licenseIds.length; i++) recycleLicense(licenseIds[i]);
    }

    /// @notice Number of recycled slots available for reuse.
    function recycledCount() external view returns (uint256) {
        return _recycledIds.length;
    }

    // ─────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────

    /// @notice Price quote for the MIC half of a purchase, so the UI can show the
    ///         buyer how much MIC they need before they sign.
    /// @dev    Uses the LOWER of spot and the 7-day average. The amount owed is inversely
    ///         proportional to price, so quoting at a high price would let someone pump
    ///         the pool to owe less MIC. Taking the minimum removes that: pushing the
    ///         price up leaves the TWAP in charge, and pushing it down makes the buyer
    ///         owe MORE. The protocol always burns at least fair value.
    function quoteMicRequired(uint256 quantity) public view returns (uint256) {
        require(quantity > 0, "MICE: zero quantity");
        uint256 round = _roundForToken(totalMinted - _recycledIds.length);
        uint256 usdtHalf = (getPriceForRound(round) / 2) * quantity;
        return _micForUsdt(usdtHalf);
    }

    /// @dev Units cancel: usdtHalf is 18-dec USDT, `px` is 18-dec USDT per 1e18 MIC
    ///      (LiquidityPoolV6.spotPrice returns effectiveUsdt * 1e18 / reserveMic), so the
    ///      result is 18-dec MIC. The arithmetic never needed a decimal shim — only the
    ///      inputs had to agree, and while prices were 6-dec they did not: the burn came
    ///      out 10^12 times too small.
    function _micForUsdt(uint256 usdtHalf_) internal view returns (uint256) {
        uint256 px;

        if (liquidityPool.isSeeded()) {
            // The market prices this from here on. Taking the lower of spot and the
            // 7-day average makes manipulation self-defeating: pushing the price up
            // leaves the average in charge, and pushing it down makes the manipulator
            // burn more MIC per licence, not less.
            uint256 spot = liquidityPool.spotPrice();
            uint256 avg  = liquidityPool.twap7d();
            px = spot < avg ? spot : avg;
        } else {
            px = bootstrapPrice;
        }

        // Reachable only if the pool reports itself seeded and still quotes nothing —
        // an impossible state that should stop a sale rather than mint a licence for free.
        require(px > 0, "MICE: no price");
        return (usdtHalf_ * 1e18) / px;
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
    ///  4. Pull MIC = usdtHalf * 1e18 / micPriceUSDT from buyer, burn it.
    ///  5. Pull USDT half from buyer.
    ///  6. Send the FULL gross USDT half to RevenueRouter (6-way gross split, incl. the
    ///     Referral 10% slice), then trigger ReferralRegistry to pay F1/F2 out of it.
    ///  7. Mint ERC-1155 license tokens (reuse recycled IDs first).
    function _buyLicenses(uint256 quantity, address referrer) private {
        require(quantity > 0, "MICE: zero quantity");
        // Seats in use = ever minted MINUS seats returned to the free list. Using
        // `totalMinted` alone permanently blocks every purchase once 100,000 have been
        // minted, even when recycled seats are sitting free — which would turn MICE
        // into one-time revenue instead of a renewable licence.
        require(
            totalMinted - _recycledIds.length + quantity <= MAX_SUPPLY,
            "MICE: exceeds max supply"
        );

        // ── (2) Register referrer (if provided and not yet set) ──────────────
        if (referrer != address(0)) {
            try referralRegistry.setReferrer(msg.sender, referrer) {} catch {}
        }

        // ── (3) Determine price (round of the first license in this batch) ──
        uint256 batchRound       = _roundForToken(totalMinted);
        uint256 pricePerLicense  = getPriceForRound(batchRound);
        uint256 totalUsdtHalf    = (pricePerLicense / 2) * quantity; // 50% × qty

        // ── (4) Pull MIC and burn ────────────────────────────────────────────
        //    Priced at min(spot, 7-day TWAP) read from the pool. No admin-set price.
        uint256 micBurnAmount = _micForUsdt(totalUsdtHalf);
        IERC20(address(micToken)).safeTransferFrom(msg.sender, address(this), micBurnAmount);
        micToken.burn(micBurnAmount);

        // ── (5) Pull USDT half ───────────────────────────────────────────────
        usdt.safeTransferFrom(msg.sender, address(this), totalUsdtHalf);

        // ── (6) Revenue routing — model V2 (2026-07), all % of GROSS ─────────
        //    Send the FULL gross USDT half to RevenueRouter, which splits 6 ways and
        //    deposits the Referral 10% slice into ReferralRegistry.
        usdt.forceApprove(address(revenueRouter), totalUsdtHalf);
        revenueRouter.receiveAndDistribute(totalUsdtHalf);

        //    Then trigger the per-buyer payout: the registry pays F1 7% + F2 3% out of the
        //    slice it just received and routes any unspent portion to Milestones & Incentives.
        //    Called unconditionally — with no referrer the whole 10% overflows to M&I instead
        //    of being stranded in the registry.
        referralRegistry.distributeReferral(msg.sender, totalUsdtHalf);

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
            owner:       to,
            mintTime:    block.timestamp,
            activatedAt: 0,
            expiryTime:  0,          // set on activation — the 360-day term starts there
            pricePaid:   price
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

    // ─────────────────────────────────────────────────────────
    // Transfers
    // ─────────────────────────────────────────────────────────

    /// @dev Licences are ERC-1155 and therefore transferable, but `licenses[id].owner`
    ///      was only ever written at mint. A transferred licence left that field pointing
    ///      at the seller, so `getUserLicenses`, `ownerOfLicense` and every reward path
    ///      built on it would have credited the wrong wallet indefinitely.
    ///
    ///      Rewards settle to the seller at the moment of transfer: they earned that MIC
    ///      while they held the licence, and it should not travel with the token.
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        super._update(from, to, ids, values);

        // Mint (from == 0) is handled by _mintOneLicense; burn (to == 0) does not occur.
        if (from == address(0) || to == address(0)) return;

        for (uint256 i = 0; i < ids.length; i++) {
            uint256 id = ids[i];
            if (values[i] == 0) continue;

            if (address(miningPool) != address(0)) {
                miningPool.onLicenceTransferred(id, from, to);
            }

            licenses[id].owner = to;
            _userLicenses[to].push(id);
            _removeUserLicense(from, id);

            emit LicenseTransferred(id, from, to);
        }
    }

    event LicenseTransferred(uint256 indexed licenseId, address indexed from, address indexed to);

    /// @dev Drops `licenseId` from `user`'s list by swapping the last entry into its
    ///      place. Order is not meaningful here, and preserving it would cost O(n) writes.
    function _removeUserLicense(address user, uint256 licenseId) private {
        uint256[] storage list = _userLicenses[user];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == licenseId) {
                list[i] = list[list.length - 1];
                list.pop();
                return;
            }
        }
    }
}
