// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LiquidityPoolV8 — protocol MIC/USDT pool, linear buy price
/// @notice LiquidityPoolV6 with one thing changed: the buy price. Everything else — the
///         retiring virtual reserve, the price accumulator, the coverage-driven sell fee,
///         the daily limits, every constant and the whole ABI — is V6 verbatim, because
///         V6 is not upgradeable and a new address was the only way to change that one
///         thing.
///
/// @dev    THE FIX. V6 quoted a buy off a constant product and evaluated the denominator
///         at `_effectiveAt(reserveUsdt + inNet)` — the effective reserve the pool *would*
///         show after the deposit. Incoming USDT also retires virtual reserve, at half its
///         own size, so that denominator moved by only half of what came in and the buyer
///         received half the MIC. On mainnet at 48h old, $50 bought 2,492.35 MIC
///         ($0.020061) against the published $0.01 — and the same $0.020060 at $1 and at
///         $10, flat, which is what rules out slippage and points at a constant factor.
///
///         V7 prices the whole pool over the whole float, on the reserves as they stand
///         *before* the trade:
///
///             micOut = usdtIn × (1 − BUY_FEE_BPS/BPS) × reserveMic / effectiveUsdt()
///
///         The 50% virtual→real substitution in `_virtualFor` was never the bug and is
///         untouched. Its only fault was placement: it belongs in the reserve update that
///         runs after a trade, where it moves the price a little for the *next* buyer, not
///         in the denominator that decides what this buyer receives.
///
///         `_effectiveAt` is gone with it — it existed solely to serve that denominator.
///
///         This is the Liquidity layer. The Sales layer (MICELicense) reads a price
///         from it; the Emission layer (EmissionController) reads coverage from it.
///         Neither of those two reads the other.
///
/// @dev    Replaces LiquidityPoolV5, which has no withdrawal path of any kind and whose
///         swap functions are `pure` reverts. V5 is not a proxy, so it cannot be fixed —
///         its MIC can only ever leave by being burned. Nothing here touches it.
///
///         Decimals: USDT is 18-dec (BSC-USD 0x55d3…7955), MIC is 18-dec. Price is quoted
///         as USDT (18-dec) per 1e18 MIC, so $0.01 per MIC is 1e16 — not 10_000, which is
///         what this line said while the constants below were still written `e6`.
/// @dev The licence contract. Read for two things only: which licences a wallet holds,
///      and whether each is mining. Status.ACTIVE == 2.
interface IMICELicenceQuota {
    function getUserLicenses(address user) external view returns (uint256[] memory);
    function statusOf(uint256 licenseId) external view returns (uint8);
    function licenses(uint256 id) external view returns (
        address owner, uint256 mintTime, uint256 activatedAt, uint256 expiryTime, uint256 pricePaid
    );
}

/// @dev The emission controller publishes the per-licence daily rate. Read live rather
///      than copied, so the allowance and the actual mining rate cannot drift apart.
interface IEmissionRate {
    function micPerLicencePerDay() external view returns (uint256);
}

contract LiquidityPoolV8 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────

    /// @notice RevenueRouter — pushes the Liquidity slice of sale revenue in.
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    /// @notice EmissionController — reports its own 7-day average issuance so the pool
    ///         can compute coverage. The Emission layer owns that number, not the pool.
    bytes32 public constant EMISSION_REPORTER_ROLE = keccak256("EMISSION_REPORTER_ROLE");

    // ─────────────────────────────────────────────────────────
    // Constants — published in advance, not adjustable by anyone
    // ─────────────────────────────────────────────────────────

    uint256 public constant BPS = 10_000;

    // ─────────────────────────────────────────────────────────
    // Sell quota — the account is the unit, not the coin
    // ─────────────────────────────────────────────────────────
    //
    // MIC is a plain ERC-20; there is no such thing as "this coin came from mining", and
    // a per-coin ledger would be defeated by a single transfer. The rule is therefore
    // about ACCOUNTS:
    //
    //     a wallet may sell what its mining licences have earned while IT held them,
    //     less what it has already sold. A wallet with no mining licence may not sell.
    //
    // Buying is untouched: anyone may buy at any time. MIC from the PreSale, a SEED
    // grant, referral or staking cannot reach the pool in this phase, which is the point.
    //
    // WHY 1x AND NOT 2x. A licence earns 83.33 MIC/day. A 2x allowance would license
    // exactly 83.33 MIC/day of NON-mined MIC to reach the pool per licence — one $100
    // licence bought as a permit to drain a PreSale bag. 1x is the only multiple that
    // matches the rule, so it is not a parameter.
    //
    // WHY THE CLOCK STARTS AT `firstSeen` AND NOT AT `activatedAt`. MICELicense._update
    // places no restriction on transferring an ACTIVE licence — verified against the
    // deployed source, not assumed. Accruing from `activatedAt` would therefore hand the
    // buyer of a 300-day-old licence 25,000 MIC of allowance it never mined, and letting
    // the licence be sold on again would make it a reusable voucher. Accrual runs from
    // the later of activation and the moment THIS pool first recorded THIS wallet holding
    // THIS licence, so a licence carries no allowance across a sale.

    /// @notice Licence contract supplying holdings and status.
    IMICELicenceQuota public miceLicence;

    /// @notice Emission controller supplying the per-licence daily rate.
    IEmissionRate public emissionController;

    /// @notice Upper bound on licences examined in one pass. A wallet holding more still
    ///         sells — it is quoted on the first slice — but the loop can never grow
    ///         until it exceeds the block gas limit and bricks selling for that wallet.
    uint256 public constant MAX_LICENCE_SCAN = 256;

    /// @notice wallet => licenceId => first time this pool saw the pair. Zero means never
    ///         seen, and a licence that has never been seen accrues nothing.
    mapping(address => mapping(uint256 => uint256)) public firstSeen;

    /// @notice Lifetime MIC sold into this pool, per wallet. Never reset.
    mapping(address => uint256) public totalSold;

    event QuotaSourcesUpdated(address miceLicence, address emissionController);
    event LicenceObserved(address indexed wallet, uint256 indexed licenceId, uint256 at);
    event QuotaConsumed(address indexed seller, uint256 micIn, uint256 remaining);

    /// @notice Buy fee, flat.
    uint256 public constant BUY_FEE_BPS = 30;          // 0.3%
    /// @notice Sell fee floor. Zero: once the pool is fully backed by real capital there
    ///         is nothing left to discourage, so selling costs nothing.
    uint256 public constant SELL_FEE_MIN_BPS = 0;      // 0%
    /// @notice Sell fee ceiling. Hard constant: no key holder and no governance vote can
    ///         raise it. Reached only when the pool is entirely virtual, and it falls to
    ///         zero as real capital replaces that virtual reserve — so the fee is high
    ///         exactly when a sale would be a claim on money the pool does not hold, and
    ///         nil once every quoted dollar is a dollar held.
    uint256 public constant MAX_FEE_BPS = 1_500;       // 15%

    /// @notice Coverage target, in days.
    uint256 public constant H_TARGET_DAYS = 110;

    /// @notice Outbound USDT per rolling 24h, as a share of real reserves. Sells only —
    ///         a buy deepens the pool, so throttling it would protect nothing. Breaching
    ///         it reverts with `over daily limit`, which is a different thing from being
    ///         over the per-trade limit and says so.
    uint256 public constant DAILY_OUT_BPS = 500;       // 5%
    /// @notice Largest single trade, as a share of the MIC reserve. Applies to both
    ///         directions. Breaching it reverts with `over per-trade limit`.
    uint256 public constant MAX_TRADE_BPS = 100;       // 1%

    /// @notice Legacy. V6 opened the sell side on this day; V7 gates on real reserves
    ///         instead — see `sellGateUsdt()`. Kept so existing readers do not revert.
    uint256 public constant SELL_OPEN_DAY = 30;
    /// @notice Real reserves at which the pool enters the listing phase.
    /// @dev 18-dec. Written as `10_000_000e6` this was $0.00001 against BSC-USD, so the
    ///      pool would leave Bootstrap for Listed on the first deposit instead of at
    ///      $10M of real reserves.
    uint256 public constant LISTING_THRESHOLD = 10_000_000 ether;   // $10M

    /// @notice Announce-to-execute delay on a MIC withdrawal. Matches ListingReserveVault.
    uint256 public constant MIC_WITHDRAW_COOLDOWN = 7 days;

    uint256 private constant DAY = 1 days;
    uint256 private constant SNAP_SLOTS = 31;          // 30 days of history + current

    // ─────────────────────────────────────────────────────────
    // Immutables
    // ─────────────────────────────────────────────────────────

    IERC20  public immutable usdt;
    IERC20  public immutable mic;

    /// @notice Real USDT the pool must have taken in before the sell side may open.
    ///
    /// @dev Explicit rather than derived from `virtualReserve0`, so the figure is visible
    ///      in the constructor arguments on BSCScan and cannot drift silently if a later
    ///      deployment changes the virtual reserve. Implicit coupling between two numbers
    ///      that nobody re-checks is how this pool's predecessor shipped at twice its
    ///      price. Deployed at $25,000 — about 4% of the $608,992 that all circulating
    ///      MIC is worth at $0.01.
    uint256 public immutable sellGateUsdt;

    /// @notice Virtual reserve at genesis. An accounting constant, never a balance — no
    ///         party can withdraw it. It exists so a two-sided price is definable on day
    ///         one, when the pool holds MIC and no USDT at all.
    uint256 public immutable virtualReserve0;

    /// @notice When the pool started operating — the moment it was first seeded with MIC,
    ///         not the moment its code was deployed. Zero until then.
    ///
    /// @dev The two used to be the same, and that quietly broke both things measured from
    ///      here. A pool holding no MIC has `spotPrice() == 0`; every second between
    ///      deployment and seeding therefore accumulated a price of zero into the TWAP.
    ///      Seed two days after deploying and `twap7d` reads about a third of the real
    ///      price for the rest of that week — which matters because MICELicense prices its
    ///      burn at `min(spot, twap7d)`, so buyers would burn roughly three times the MIC
    ///      they owe, and `brakeEngaged()` would trip and halve emission on a price that
    ///      never actually fell.
    ///
    ///      Measuring from the seed also gives the 30-day sell gate its intended meaning:
    ///      thirty days of a *working* pool, not thirty days of an address existing.
    uint256 public startTime;

    // ─────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────

    enum Phase { Bootstrap, TwoWay, Listed }
    Phase public phase;

    /// @notice Real USDT reserve. Tracked explicitly rather than read from balanceOf so a
    ///         donation cannot silently move the price.
    uint256 public reserveUsdt;

    /// @notice Highest real reserve ever reached. Virtual-reserve retirement is measured
    ///         against this, never against the live balance, so retirement is one-way.
    ///         Without it a sale would un-retire virtual depth and re-inflate the phantom
    ///         side of the curve at exactly the moment the pool is weakening.
    uint256 public reserveUsdtHighWater;
    /// @notice Real MIC reserve, tracked for the same reason.
    uint256 public reserveMic;

    /// @notice 7-day average daily issuance in MIC, reported by the Emission layer.
    uint256 public avgDailyEmission;

    // Price accumulator ────────────────────────────────────────
    uint256 public priceCumulative;
    uint256 public lastCumulativeUpdate;

    struct Snapshot { uint64 timestamp; uint192 cumulative; }
    /// @dev Ring of daily snapshots, indexed by (day since start) % SNAP_SLOTS.
    Snapshot[SNAP_SLOTS] public snapshots;
    uint256 public lastSnapshotDay;
    bool private _snapshotsSeeded;

    // Daily outflow limiter ────────────────────────────────────
    uint256 public windowStart;
    uint256 public usdtOutInWindow;

    // Same-block guard ─────────────────────────────────────────
    mapping(address => uint256) private _lastTradeBlock;

    // Announced MIC withdrawal ─────────────────────────────────
    struct MicWithdrawal {
        address recipient;
        uint256 amount;
        uint64  requestedAt;
        uint64  executableAt;
        string  reason;
    }
    /// @notice The single pending MIC withdrawal, if any. `amount == 0` means none.
    MicWithdrawal public pendingMicWithdrawal;
    uint256 public totalMicWithdrawn;

    // Accounting ───────────────────────────────────────────────
    uint256 public totalFeesCollected;
    uint256 public totalUsdtReceived;

    // ─────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────

    event Bought(address indexed buyer, uint256 usdtIn, uint256 micOut, uint256 feeBps);
    event Sold(address indexed seller, uint256 micIn, uint256 usdtOut, uint256 feeBps);
    event UsdtReceived(address indexed from, uint256 amount);
    event MicSeeded(address indexed from, uint256 amount);
    /// @notice The pool went live. Emitted once, on the first seed.
    event PoolStarted(uint256 startedAt, uint256 micSeeded);
    event PhaseAdvanced(Phase from, Phase to);
    event EmissionReported(uint256 avgDailyEmission);
    event MicWithdrawRequested(address indexed recipient, uint256 amount, uint64 executableAt, string reason);
    event MicWithdrawExecuted(address indexed recipient, uint256 amount);
    event MicWithdrawCancelled(address indexed recipient, uint256 amount);

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    /// @param _virtualReserve0 Virtual USDT reserve (18-dec). With a MIC seed of M and an
    ///        intended opening price P₀, set this to P₀ × M — the float's notional value.
    ///        It retires one-for-one as real USDT arrives and reaches zero at its own
    ///        size, at which point every dollar the curve quotes is a dollar held.
    ///        Deployed at $0.01 × 23,500,000 = $235,000.
    constructor(
        address _usdt,
        address _mic,
        uint256 _virtualReserve0,
        uint256 _sellGateUsdt,
        address admin
    ) {
        require(_usdt != address(0) && _mic != address(0), "LP8: zero token");
        require(admin != address(0), "LP8: zero admin");
        require(_virtualReserve0 > 0, "LP8: zero virtual reserve");
        require(_sellGateUsdt > 0, "LP8: zero sell gate");
        // A gate above the virtual reserve could never be reached by substitution alone.
        require(_sellGateUsdt <= _virtualReserve0, "LP8: gate above virtual reserve");
        // The virtual reserve anchors the opening price; supplied in 6 decimals it
        // would anchor at effectively zero and price MIC at nothing.
        require(IERC20Metadata(_usdt).decimals() == 18, "LP8: usdt must be 18 decimals");

        usdt = IERC20(_usdt);
        mic  = IERC20(_mic);
        virtualReserve0 = _virtualReserve0;
        sellGateUsdt    = _sellGateUsdt;
        // startTime stays zero: the pool is dormant until `seedMic` gives it MIC to price.
        phase = Phase.Bootstrap;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ─────────────────────────────────────────────────────────
    // Pricing
    // ─────────────────────────────────────────────────────────

    /// @notice Virtual reserve remaining. Retires **one-for-one** with real inflow: every
    ///         real dollar that arrives stands in for exactly one virtual dollar, so the
    ///         effective side of the curve holds steady at `virtualReserve0` until the
    ///         substitution is complete. It reaches zero when real reserves equal its own
    ///         starting size, and from then on the pool is a plain constant-product AMM
    ///         over real capital only.
    ///
    /// @dev    V6 retired at half the inflow (`highWater / 2`), which made `effectiveUsdt`
    ///         grow as money came in. One-for-one is the rule this pool is deployed under:
    ///         backing is constant at `virtualReserve0`, first notional, then actual.
    ///
    ///         The consequence worth stating plainly: while virtual reserve remains, the
    ///         price moves **only because MIC leaves**, never because USDT arrives. A
    ///         deposit changes what the backing is made of, not how much of it there is.
    ///
    ///         Measured against `reserveUsdtHighWater`, never the live balance, so
    ///         retirement is one-way — a later sale cannot un-retire virtual depth and
    ///         re-inflate the phantom side exactly when the pool is weakening.
    function virtualReserve() public view returns (uint256) {
        return _virtualFor(reserveUsdtHighWater);
    }

    function _virtualFor(uint256 highWater) internal view returns (uint256) {
        return highWater >= virtualReserve0 ? 0 : virtualReserve0 - highWater;
    }

    /// @notice Effective USDT side of the curve: real plus whatever virtual remains.
    ///         Constant at `virtualReserve0` until the substitution completes — real
    ///         capital displaces virtual one-for-one — then it is simply the real reserve.
    function effectiveUsdt() public view returns (uint256) {
        return reserveUsdt + virtualReserve();
    }

    /// @notice USDT (18-dec) per 1e18 MIC.
    function spotPrice() public view returns (uint256) {
        if (reserveMic == 0) return 0;
        return (effectiveUsdt() * 1e18) / reserveMic;
    }

    // ─────────────────────────────────────────────────────────
    // Price accumulator and averages
    // ─────────────────────────────────────────────────────────

    /// @dev Accrues price×time and writes a daily snapshot when the day rolls over.
    ///      Called before every state change and by `poke()`.
    function _accrue() internal {
        // Nothing to average before the pool has a price. Accumulating zeros here is
        // exactly what would poison the TWAP.
        if (startTime == 0) return;

        uint256 elapsed = block.timestamp - lastCumulativeUpdate;
        if (elapsed > 0) {
            priceCumulative += spotPrice() * elapsed;
            lastCumulativeUpdate = block.timestamp;
        }
        uint256 day = (block.timestamp - startTime) / DAY;
        if (!_snapshotsSeeded || day > lastSnapshotDay) {
            snapshots[day % SNAP_SLOTS] =
                Snapshot(uint64(block.timestamp), uint192(priceCumulative));
            lastSnapshotDay = day;
            _snapshotsSeeded = true;
        }
    }

    /// @notice Anyone may advance the accumulator. Useful on quiet days so the averages
    ///         keep tracking rather than going stale.
    function poke() external { _accrue(); }

    /// @dev Average price over the last `windowDays`, or over the pool's whole life if it
    ///      is younger than that. Falls back to spot when no time has elapsed.
    function _twap(uint256 windowDays) internal view returns (uint256) {
        if (startTime == 0) return 0;
        uint256 nowCum = priceCumulative
            + spotPrice() * (block.timestamp - lastCumulativeUpdate);

        uint256 age = block.timestamp - startTime;
        uint256 span = windowDays * DAY;
        if (age < span) span = age;
        if (span == 0) return spotPrice();

        uint256 targetDay = (block.timestamp - span - startTime) / DAY;
        Snapshot memory snap = snapshots[targetDay % SNAP_SLOTS];
        if (snap.timestamp == 0 || snap.timestamp >= block.timestamp) return spotPrice();

        uint256 dt = block.timestamp - snap.timestamp;
        if (dt == 0) return spotPrice();
        return (nowCum - uint256(snap.cumulative)) / dt;
    }

    /// @notice 7-day average. Window is min(7 days, pool age) so it is defined from day one.
    function twap7d() public view returns (uint256) { return _twap(7); }

    /// @notice 30-day average, same windowing rule.
    function twap30d() public view returns (uint256) { return _twap(30); }

    // ─────────────────────────────────────────────────────────
    // Coverage and fees
    // ─────────────────────────────────────────────────────────

    /// @notice Liquidity coverage in DAYS: how many days of new issuance the pool's real
    ///         USDT could absorb at the 7-day average price. **Reporting only in V7** —
    ///         the sell fee is driven by `backingBps()` instead, because this figure is
    ///         `type(uint256).max` until EmissionController reports and would have left
    ///         the fee pinned at its floor.
    /// @dev    This measures the pool's capacity, NOT the health of the price. The two
    ///         move in opposite directions when price falls — a cheaper MIC makes each
    ///         day of issuance worth less, so coverage rises. The price brakes live in
    ///         EmissionController for exactly that reason; do not treat H as a price signal.
    function coverageH() public view returns (uint256) {
        if (avgDailyEmission == 0) return type(uint256).max;
        uint256 dailyValue = (avgDailyEmission * twap7d()) / 1e18;   // USDT 18-dec
        if (dailyValue == 0) return type(uint256).max;
        return reserveUsdt / dailyValue;
    }

    /// @notice How much of the quoted depth is real, in basis points. 10,000 means every
    ///         dollar the curve can quote is a dollar the pool actually holds.
    function backingBps() public view returns (uint256) {
        uint256 e = effectiveUsdt();
        if (e == 0) return 0;
        uint256 b = (reserveUsdt * BPS) / e;
        return b > BPS ? BPS : b;
    }

    /// @notice Sell fee in basis points, from a published formula. No admin path exists.
    ///         Runs from `MAX_FEE_BPS` when the pool is almost entirely virtual down to
    ///         `SELL_FEE_MIN_BPS` when it is fully real — 10% to 0%.
    ///
    /// @dev    V6 drove this off `coverageH()`, which measures how many days of *emission*
    ///         the reserve could absorb. That is a real metric but it is the wrong one
    ///         here, and it fails silently: `coverageH` returns `type(uint256).max`
    ///         whenever `avgDailyEmission` is zero, and EmissionController has never
    ///         reported. So the fee sat at its floor no matter how thin the pool was — a
    ///         brake wired to a pedal nobody is pressing.
    ///
    ///         Backing is the quantity that actually matters to a seller: it is the share
    ///         of the quote the pool can honour. It needs no reporter, cannot go stale,
    ///         and moves the fee in the right direction automatically — expensive to sell
    ///         out of a thin pool, free once real capital has replaced the virtual.
    function sellFeeBps() public view returns (uint256) {
        uint256 b = backingBps();
        return MAX_FEE_BPS - ((MAX_FEE_BPS - SELL_FEE_MIN_BPS) * b) / BPS;
    }

    // ─────────────────────────────────────────────────────────
    // Phases
    // ─────────────────────────────────────────────────────────

    /// @notice True once the pool holds MIC and has begun pricing.
    function isSeeded() public view returns (bool) {
        return startTime != 0;
    }

    function poolAgeDays() public view returns (uint256) {
        if (startTime == 0) return 0;
        return (block.timestamp - startTime) / DAY;
    }

    /// @notice True once the pool will honour a sale.
    function sellsOpen() public view returns (bool) {
        return phase != Phase.Bootstrap;
    }

    /// @notice Move to the next phase if its condition is met. Permissionless: it verifies
    ///         the condition on-chain, so there is no operator switch anywhere.
    ///
    /// @dev    The sell gate is the pool's own reserves, not the calendar. V6 opened sells
    ///         30 days after the seed regardless of what stood behind them — and since
    ///         this function is permissionless and the mining keeper calls it every tick,
    ///         that pool opens its sell side on 2026-09-11 with $10 of real USDT against
    ///         50M MIC. A timer cannot know whether the money arrived.
    ///
    ///         `virtualReserve() == 0` is the honest condition: it is true exactly when
    ///         every dollar the curve can quote is a dollar the pool actually holds. Until
    ///         then a sale would be a promise against phantom depth. `SELL_OPEN_DAY` is
    ///         kept in the ABI for readers that still fetch it, but it no longer gates
    ///         anything — read `sellGateUsdt()` and `sellsOpen()` instead.
    function advancePhase() external {
        Phase from = phase;
        if (phase == Phase.Bootstrap && reserveUsdtHighWater >= sellGateUsdt) {
            phase = Phase.TwoWay;
        } else if (phase == Phase.TwoWay && reserveUsdt >= LISTING_THRESHOLD) {
            phase = Phase.Listed;
        } else {
            revert("LP8: condition not met");
        }
        emit PhaseAdvanced(from, phase);
    }

    // ─────────────────────────────────────────────────────────
    // Inbound
    // ─────────────────────────────────────────────────────────

    /// @notice Seed MIC into the pool. Used once at launch from ListingReserveVault.
    /// @notice Point the quota at its two sources.
    /// @dev Settable because both can be replaced — EmissionControllerV2 replaced V1 on
    ///      2026-08-18, and a frozen pointer is exactly what made V1 unfixable. The power
    ///      is real: pointing this at a contract reporting a large rate would widen every
    ///      allowance. It is the same DEFAULT_ADMIN_ROLE that already governs the pool,
    ///      and every change is logged.
    function setQuotaSources(address _miceLicence, address _emissionController)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_miceLicence != address(0) && _emissionController != address(0), "LP8: zero address");
        miceLicence = IMICELicenceQuota(_miceLicence);
        emissionController = IEmissionRate(_emissionController);
        emit QuotaSourcesUpdated(_miceLicence, _emissionController);
    }

    function seedMic(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(amount > 0, "LP8: zero amount");

        // The first seed is what brings the pool to life: it starts the clock, the price
        // history and the 30-day countdown together, all from this instant.
        if (startTime == 0) {
            startTime = block.timestamp;
            lastCumulativeUpdate = block.timestamp;
            emit PoolStarted(block.timestamp, amount);
        }

        _accrue();
        mic.safeTransferFrom(msg.sender, address(this), amount);
        reserveMic += amount;
        emit MicSeeded(msg.sender, amount);
    }

    /// @notice RevenueRouter pushes the Liquidity slice here. Deepens the pool without
    ///         taking MIC out, replacing virtual capital with real capital one-for-one.
    ///
    /// @dev    Deliberately accepts USDT BEFORE the pool is seeded, unlike V6.
    ///
    ///         V6 refused, and had to: it retired virtual reserve at half the inflow, so
    ///         every dollar arriving early raised `effectiveUsdt` and the pool would have
    ///         opened above the published $0.01.
    ///
    ///         One-for-one removes that. A real dollar displaces exactly one virtual
    ///         dollar, so `effectiveUsdt` stays pinned at `virtualReserve0` however much
    ///         arrives first, and the opening price is `virtualReserve0 / seedAmount` —
    ///         $0.01 — whether nothing arrives beforehand or the whole $235,000 does.
    ///
    ///         This is operational, not academic: RevenueRouter calls this in the SAME
    ///         transaction as a Pre-Sale or MICE purchase. A pool that reverts here is a
    ///         pool that reverts the sale. V6's guard, carried over unthinkingly, would
    ///         have halted every sale for the seven days between deploying this pool and
    ///         seeding it.
    ///
    ///         Past `virtualReserve0` the virtual side is exhausted and further deposits
    ///         do lift the opening price. That needs $235,000 before the seed; the deploy
    ///         script projects the opening price before broadcasting and refuses to seed
    ///         if it is not exactly $0.01.
    function receiveUSDT(uint256 amount) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        require(amount > 0, "LP8: zero amount");
        _accrue();
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        reserveUsdt += amount;
        if (reserveUsdt > reserveUsdtHighWater) reserveUsdtHighWater = reserveUsdt;
        totalUsdtReceived += amount;
        emit UsdtReceived(msg.sender, amount);
    }

    /// @notice EmissionController reports its own 7-day average issuance.
    function reportDailyEmission(uint256 avg7d) external onlyRole(EMISSION_REPORTER_ROLE) {
        _accrue();
        avgDailyEmission = avg7d;
        emit EmissionReported(avg7d);
    }

    // ─────────────────────────────────────────────────────────
    // Swaps
    // ─────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────
    // Sell quota
    // ─────────────────────────────────────────────────────────

    /// @notice Record the caller-supplied wallet as holding its current licences, starting
    ///         their accrual now. Permissionless: it can only ever start a clock, never
    ///         move one that is already running, so there is nothing to grief.
    /// @dev The DApp calls this at activation and on receiving a licence. A wallet that
    ///      never calls it simply accrues from its first sale instead.
    function syncQuota(address wallet) public returns (uint256 observed) {
        if (address(miceLicence) == address(0)) return 0;
        uint256[] memory ids = miceLicence.getUserLicenses(wallet);
        uint256 n = ids.length > MAX_LICENCE_SCAN ? MAX_LICENCE_SCAN : ids.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 id = ids[i];
            if (firstSeen[wallet][id] != 0) continue;
            if (miceLicence.statusOf(id) != 2) continue;      // only a mining licence starts a clock
            firstSeen[wallet][id] = block.timestamp;
            observed += 1;
            emit LicenceObserved(wallet, id, block.timestamp);
        }
    }

    /// @notice How many of `who`'s licences are mining right now.
    function activeMiceOf(address who) public view returns (uint256 count) {
        if (address(miceLicence) == address(0)) return 0;
        uint256[] memory ids = miceLicence.getUserLicenses(who);
        uint256 n = ids.length > MAX_LICENCE_SCAN ? MAX_LICENCE_SCAN : ids.length;
        for (uint256 i = 0; i < n; i++) {
            if (miceLicence.statusOf(ids[i]) == 2) count += 1;
        }
    }

    /// @notice MIC this wallet has earned across every licence it is recorded as holding,
    ///         since the pool first saw it hold that licence. Gross, before sales.
    /// @dev Priced at the CURRENT rate, including for elapsed time. A rate change is
    ///      therefore retroactive across the open window. That is deliberate: the
    ///      alternative is a per-wallet rate history, and the rate is a governance
    ///      parameter that moves rarely, inside published bounds.
    function minedToDate(address who) public view returns (uint256 total) {
        if (address(miceLicence) == address(0) || address(emissionController) == address(0)) return 0;
        uint256 rate = emissionController.micPerLicencePerDay();
        if (rate == 0) return 0;

        uint256[] memory ids = miceLicence.getUserLicenses(who);
        uint256 n = ids.length > MAX_LICENCE_SCAN ? MAX_LICENCE_SCAN : ids.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 id = ids[i];
            uint256 seen = firstSeen[who][id];
            if (seen == 0) continue;                          // never observed here

            (, , uint256 activatedAt, uint256 expiryTime, ) = miceLicence.licenses(id);
            if (activatedAt == 0) continue;                   // not mining

            uint256 from = activatedAt > seen ? activatedAt : seen;
            uint256 to   = block.timestamp;
            if (expiryTime != 0 && expiryTime < to) to = expiryTime;   // earning stops at expiry
            if (to <= from) continue;

            total += (rate * (to - from)) / 1 days;
        }
    }

    /// @notice What `who` may still sell. Zero is a complete answer, not a pending state.
    /// @dev Saturating: a licence sold on or recycled leaves the wallet's holdings, so
    ///      `minedToDate` can fall below what was already sold. The shortfall is simply
    ///      no further allowance — it is never a debt and never underflows.
    function sellQuotaOf(address who) public view returns (uint256) {
        uint256 mined = minedToDate(who);
        uint256 sold  = totalSold[who];
        return sold >= mined ? 0 : mined - sold;
    }

    /// @notice Buy MIC with USDT.
    /// @param minMicOut Slippage guard — the transaction reverts below this.
    function swapUsdtToMic(uint256 usdtIn, uint256 minMicOut)
        external nonReentrant returns (uint256 micOut)
    {
        require(startTime != 0, "LP8: pool not seeded");
        require(usdtIn > 0, "LP8: zero amount");
        require(_lastTradeBlock[msg.sender] != block.number, "LP8: same block");
        _accrue();

        uint256 fee = (usdtIn * BUY_FEE_BPS) / BPS;

        // Priced on the reserves as they stand, before anything moves — and through the
        // very function the front end quoted from, so what was shown is what executes.
        // In V6 these were two separate expressions; they must not be able to drift.
        micOut = quoteBuy(usdtIn);

        require(micOut >= minMicOut, "LP8: slippage");
        require(micOut > 0, "LP8: zero out");
        require(micOut <= (reserveMic * MAX_TRADE_BPS) / BPS, "LP8: over per-trade limit");

        usdt.safeTransferFrom(msg.sender, address(this), usdtIn);
        // The fee stays in the pool: it deepens reserves, which raises coverage and
        // therefore lowers the sell fee again.
        reserveUsdt += usdtIn;
        if (reserveUsdt > reserveUsdtHighWater) reserveUsdtHighWater = reserveUsdt;
        reserveMic  -= micOut;
        totalFeesCollected += fee;
        _lastTradeBlock[msg.sender] = block.number;

        mic.safeTransfer(msg.sender, micOut);
        emit Bought(msg.sender, usdtIn, micOut, BUY_FEE_BPS);
    }

    /// @notice Sell MIC for USDT. Closed during Bootstrap because the pool holds no USDT
    ///         to honour it — that is a physical constraint, not a policy choice.
    /// @param minUsdtOut Slippage guard.
    function swapMicToUsdt(uint256 micIn, uint256 minUsdtOut)
        external nonReentrant returns (uint256 usdtOut)
    {
        require(startTime != 0, "LP8: pool not seeded");
        require(phase != Phase.Bootstrap, "LP8: sells not open");
        require(micIn > 0, "LP8: zero amount");
        require(_lastTradeBlock[msg.sender] != block.number, "LP8: same block");
        require(micIn <= (reserveMic * MAX_TRADE_BPS) / BPS, "LP8: over per-trade limit");

        // Start the clock on any licence not yet observed. This does NOT rescue a wallet
        // that has never synced: the require below would revert, and the revert unwinds
        // this write with it. What it does cover is the ordinary case of a holder who
        // already has allowance from one licence and has since acquired another — the new
        // licence starts earning on their next sale without a separate transaction.
        //
        // A wallet with no synced licence at all must call `syncQuota` once. It is
        // permissionless, so the DApp does it at activation and anyone can do it for
        // anyone; nothing is retroactive either way.
        syncQuota(msg.sender);

        // The account gate. Checked before any state moves, so a wallet without mining
        // licences is refused outright rather than part-filled.
        uint256 quota = sellQuotaOf(msg.sender);
        require(quota > 0, "LP8: no mining allowance");
        require(micIn <= quota, "LP8: over mining allowance");
        totalSold[msg.sender] += micIn;

        _accrue();

        uint256 k = effectiveUsdt() * reserveMic;
        uint256 newMic = reserveMic + micIn;
        uint256 targetEff = k / newMic;
        uint256 gross = effectiveUsdt() > targetEff ? effectiveUsdt() - targetEff : 0;

        uint256 feeBps = sellFeeBps();
        uint256 fee = (gross * feeBps) / BPS;
        usdtOut = gross - fee;

        // The buy path has always had this guard; the sell path never did. Without it a
        // dust sale whose `gross` rounds to zero takes the seller's MIC and pays nothing —
        // the transaction succeeds and the seller is simply out of pocket.
        require(usdtOut > 0, "LP8: zero out");
        require(usdtOut >= minUsdtOut, "LP8: slippage");
        _checkAndBookOutflow(usdtOut);

        // The curve can quote more than the pool actually holds, because part of the
        // reserve is virtual. This is the hard stop on that.
        require(usdtOut <= usdt.balanceOf(address(this)), "LP8: insufficient balance");
        require(usdtOut <= reserveUsdt, "LP8: insufficient reserve");

        mic.safeTransferFrom(msg.sender, address(this), micIn);
        reserveMic  += micIn;
        reserveUsdt -= usdtOut;      // the fee portion stays behind
        totalFeesCollected += fee;
        _lastTradeBlock[msg.sender] = block.number;

        usdt.safeTransfer(msg.sender, usdtOut);
        emit Sold(msg.sender, micIn, usdtOut, feeBps);
        emit QuotaConsumed(msg.sender, micIn, quota - micIn);
    }

    // ─────────────────────────────────────────────────────────
    // MIC migration — announce, wait, execute
    // ─────────────────────────────────────────────────────────

    /// @notice Announce a MIC withdrawal. Executable after `MIC_WITHDRAW_COOLDOWN`.
    ///
    /// @dev    Exists because three contracts in this system already hold MIC they can
    ///         never send: LiquidityPool v5, LiquidityPoolV6 (50,000,000) and
    ///         TreasuryManager (105,000,000). `TreasuryManagerV2` states the rule that
    ///         came out of it — *a contract that can hold a token must be able to send
    ///         that token* — and this is that rule applied here. Without it, consolidating
    ///         this pool into any successor is impossible and 23,500,000 MIC joins the
    ///         other 155,000,000.
    ///
    ///         Taking MIC out raises `effectiveUsdt()/reserveMic` — the remaining float is
    ///         backed by the same capital. That is why it is announced rather than
    ///         immediate: the intent sits on chain for a week, cancellable, before it can
    ///         execute. Same shape as ListingReserveVault, which governs the MIC that
    ///         seeds this pool in the first place.
    function requestMicWithdraw(address recipient, uint256 amount, string calldata reason)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(recipient != address(0), "LP8: zero recipient");
        require(amount > 0 && amount <= reserveMic, "LP8: bad amount");

        uint64 executableAt = uint64(block.timestamp + MIC_WITHDRAW_COOLDOWN);
        pendingMicWithdrawal = MicWithdrawal({
            recipient:    recipient,
            amount:       amount,
            requestedAt:  uint64(block.timestamp),
            executableAt: executableAt,
            reason:       reason
        });
        emit MicWithdrawRequested(recipient, amount, executableAt, reason);
    }

    /// @notice Execute the announced withdrawal once its cooldown has passed.
    function executeMicWithdraw() external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        MicWithdrawal memory w = pendingMicWithdrawal;
        require(w.amount > 0, "LP8: no request");
        require(block.timestamp >= w.executableAt, "LP8: cooldown active");
        // The float can have shrunk through sales since the announcement.
        require(w.amount <= reserveMic, "LP8: insufficient reserve");

        _accrue();
        delete pendingMicWithdrawal;
        reserveMic -= w.amount;
        totalMicWithdrawn += w.amount;

        mic.safeTransfer(w.recipient, w.amount);
        emit MicWithdrawExecuted(w.recipient, w.amount);
    }

    /// @notice Drop the announced withdrawal.
    function cancelMicWithdraw() external onlyRole(DEFAULT_ADMIN_ROLE) {
        MicWithdrawal memory w = pendingMicWithdrawal;
        require(w.amount > 0, "LP8: no request");
        delete pendingMicWithdrawal;
        emit MicWithdrawCancelled(w.recipient, w.amount);
    }

    /// @dev Rolling 24-hour cap on outbound USDT.
    function _checkAndBookOutflow(uint256 amount) internal {
        if (block.timestamp >= windowStart + DAY) {
            windowStart = block.timestamp;
            usdtOutInWindow = 0;
        }
        uint256 cap = (reserveUsdt * DAILY_OUT_BPS) / BPS;
        require(usdtOutInWindow + amount <= cap, "LP8: over daily limit");
        usdtOutInWindow += amount;
    }

    // ─────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────

    /// @notice MIC a buyer receives for `usdtIn`, at the reserves as they stand now.
    /// @dev    Linear — the unit price does not move inside a trade, so $1 and $50 buy at
    ///         the same price. `public` rather than `external` so `swapUsdtToMic` can call
    ///         it instead of repeating the arithmetic.
    function quoteBuy(uint256 usdtIn) public view returns (uint256) {
        if (usdtIn == 0 || reserveMic == 0 || startTime == 0) return 0;
        uint256 eff = effectiveUsdt();
        if (eff == 0) return 0;
        uint256 inNet = usdtIn - (usdtIn * BUY_FEE_BPS) / BPS;
        return (inNet * reserveMic) / eff;
    }

    /// @notice USDT a seller would actually receive, or **0 if the trade cannot execute**.
    ///
    /// @dev    V6 quoted straight off the curve and applied only the fee, so it happily
    ///         returned a figure that `swapMicToUsdt` would then refuse — over the daily
    ///         cap, over the trade cap, or simply more USDT than the pool holds. A quote
    ///         that cannot be filled is the same defect as a quote at the wrong price:
    ///         the screen says one thing and the chain does another.
    ///
    ///         Every guard `swapMicToUsdt` enforces is applied here, in the same order, so
    ///         a non-zero quote is a trade that will go through. Pair it with
    ///         `maxSellNow()` to show the seller the largest amount that will.
    function quoteSell(uint256 micIn) external view returns (uint256) {
        if (micIn == 0 || reserveMic == 0 || startTime == 0) return 0;
        if (phase == Phase.Bootstrap) return 0;
        if (micIn > (reserveMic * MAX_TRADE_BPS) / BPS) return 0;

        uint256 e = effectiveUsdt();
        uint256 gross = e - ((e * reserveMic) / (reserveMic + micIn));
        uint256 out = gross - (gross * sellFeeBps()) / BPS;

        if (out == 0) return 0;
        if (out > remainingDailyOut()) return 0;
        if (out > reserveUsdt) return 0;
        if (out > usdt.balanceOf(address(this))) return 0;
        return out;
    }

    /// @notice Largest single trade the per-trade limit allows, in MIC. Same figure for a
    ///         buy and for a sell — it is a share of the MIC reserve, not of either side.
    function maxTradeMic() public view returns (uint256) {
        return (reserveMic * MAX_TRADE_BPS) / BPS;
    }

    /// @notice Largest MIC amount that would execute right now, given the trade cap, the
    ///         rolling daily cap and what the pool actually holds. Zero while sells are
    ///         shut. This is the number a sell form should cap its input at.
    function maxSellNow() external view returns (uint256) {
        if (reserveMic == 0 || startTime == 0 || phase == Phase.Bootstrap) return 0;

        uint256 tradeCap = maxTradeMic();

        uint256 cap = remainingDailyOut();
        if (reserveUsdt < cap) cap = reserveUsdt;
        uint256 held = usdt.balanceOf(address(this));
        if (held < cap) cap = held;
        if (cap == 0) return 0;

        // Invert the curve: the micIn whose net payout is exactly `cap`.
        uint256 grossNeeded = (cap * BPS) / (BPS - sellFeeBps());
        uint256 e = effectiveUsdt();
        if (grossNeeded >= e) return tradeCap;          // cap is unreachable — size binds

        uint256 target = (e * reserveMic) / (e - grossNeeded);   // reserveMic + micIn
        uint256 micIn = target > reserveMic ? target - reserveMic : 0;
        return micIn < tradeCap ? micIn : tradeCap;
    }

    function remainingDailyOut() public view returns (uint256) {
        uint256 cap = (reserveUsdt * DAILY_OUT_BPS) / BPS;
        if (block.timestamp >= windowStart + DAY) return cap;
        return usdtOutInWindow >= cap ? 0 : cap - usdtOutInWindow;
    }
}
