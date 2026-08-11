// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title LiquidityPoolV6 — protocol MIC/USDT pool
/// @notice Constant-product pool with a retiring virtual reserve, an on-chain price
///         accumulator, a coverage-driven sell fee and hard daily limits.
///
///         This is the Liquidity layer. The Sales layer (MICELicense) reads a price
///         from it; the Emission layer (EmissionController) reads coverage from it.
///         Neither of those two reads the other.
///
/// @dev    Replaces LiquidityPoolV5, which has no withdrawal path of any kind and whose
///         swap functions are `pure` reverts. V5 is not a proxy, so it cannot be fixed —
///         its MIC can only ever leave by being burned. Nothing here touches it.
///
///         Decimals: USDT is 6-dec, MIC is 18-dec. Price is quoted as USDT (6-dec) per
///         1e18 MIC, so a price of 10_000 means $0.01 per MIC.
contract LiquidityPoolV6 is AccessControl, ReentrancyGuard {
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

    /// @notice Buy fee, flat.
    uint256 public constant BUY_FEE_BPS = 30;          // 0.3%
    /// @notice Sell fee floor, equal to the buy fee.
    uint256 public constant SELL_FEE_MIN_BPS = 30;     // 0.3%
    /// @notice Sell fee ceiling. Hard constant: no key holder and no governance vote can
    ///         raise it. A holder always has a zero-fee alternative (selling directly to a
    ///         licence buyer), so a punitive cap would not stop selling — it would only
    ///         push the flow out of the pool and cost the pool the USDT it would have kept.
    uint256 public constant MAX_FEE_BPS = 1_000;       // 10%

    /// @notice Coverage target, in days.
    uint256 public constant H_TARGET_DAYS = 110;

    /// @notice Outbound USDT per rolling 24h, as a share of real reserves.
    uint256 public constant DAILY_OUT_BPS = 500;       // 5%
    /// @notice Largest single trade, as a share of the MIC reserve.
    uint256 public constant MAX_TRADE_BPS = 100;       // 1%

    /// @notice Day on which the sell direction opens.
    uint256 public constant SELL_OPEN_DAY = 30;
    /// @notice Real reserves at which the pool enters the listing phase.
    /// @dev 18-dec. Written as `10_000_000e6` this was $0.00001 against BSC-USD, so the
    ///      pool would leave Bootstrap for Listed on the first deposit instead of at
    ///      $10M of real reserves.
    uint256 public constant LISTING_THRESHOLD = 10_000_000 ether;   // $10M

    uint256 private constant DAY = 1 days;
    uint256 private constant SNAP_SLOTS = 31;          // 30 days of history + current

    // ─────────────────────────────────────────────────────────
    // Immutables
    // ─────────────────────────────────────────────────────────

    IERC20  public immutable usdt;
    IERC20  public immutable mic;

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

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    /// @param _virtualReserve0 Virtual USDT reserve (6-dec). With a MIC seed of M and an
    ///        intended opening price P₀, set this to P₀ × M. It retires as real USDT
    ///        arrives and reaches zero at 2× its own size.
    constructor(address _usdt, address _mic, uint256 _virtualReserve0, address admin) {
        require(_usdt != address(0) && _mic != address(0), "LP6: zero token");
        require(admin != address(0), "LP6: zero admin");
        require(_virtualReserve0 > 0, "LP6: zero virtual reserve");
        // The virtual reserve anchors the opening price; supplied in 6 decimals it
        // would anchor at effectively zero and price MIC at nothing.
        require(IERC20Metadata(_usdt).decimals() == 18, "LP6: usdt must be 18 decimals");

        usdt = IERC20(_usdt);
        mic  = IERC20(_mic);
        virtualReserve0 = _virtualReserve0;
        // startTime stays zero: the pool is dormant until `seedMic` gives it MIC to price.
        phase = Phase.Bootstrap;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ─────────────────────────────────────────────────────────
    // Pricing
    // ─────────────────────────────────────────────────────────

    /// @notice Virtual reserve remaining. Retires at half the rate of real inflow, so it
    ///         reaches zero once real reserves are twice its starting size. Retirement is
    ///         continuous, so no price step occurs when it finishes.
    function virtualReserve() public view returns (uint256) {
        return _virtualFor(reserveUsdtHighWater);
    }

    function _virtualFor(uint256 highWater) internal view returns (uint256) {
        uint256 used = highWater / 2;
        return used >= virtualReserve0 ? 0 : virtualReserve0 - used;
    }

    /// @notice Effective USDT side of the curve: real plus whatever virtual remains.
    function effectiveUsdt() public view returns (uint256) {
        return reserveUsdt + virtualReserve();
    }

    /// @dev Effective reserve the curve WOULD show at a given real balance. Needed because
    ///      adding USDT also retires virtual reserve, so the effective side does not move
    ///      one-for-one with the real side while retirement is still in progress.
    function _effectiveAt(uint256 realUsdt) internal view returns (uint256) {
        uint256 hw = realUsdt > reserveUsdtHighWater ? realUsdt : reserveUsdtHighWater;
        return realUsdt + _virtualFor(hw);
    }

    /// @notice USDT (6-dec) per 1e18 MIC.
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
    ///         USDT could absorb at the 7-day average price.
    /// @dev    This measures the pool's capacity, NOT the health of the price. The two
    ///         move in opposite directions when price falls — a cheaper MIC makes each
    ///         day of issuance worth less, so coverage rises. The price brakes live in
    ///         EmissionController for exactly that reason; do not treat H as a price signal.
    function coverageH() public view returns (uint256) {
        if (avgDailyEmission == 0) return type(uint256).max;
        uint256 dailyValue = (avgDailyEmission * twap7d()) / 1e18;   // USDT 6-dec
        if (dailyValue == 0) return type(uint256).max;
        return reserveUsdt / dailyValue;
    }

    /// @notice Sell fee in basis points, from published formula. No admin path exists.
    function sellFeeBps() public view returns (uint256) {
        uint256 h = coverageH();
        if (h >= H_TARGET_DAYS) return SELL_FEE_MIN_BPS;
        uint256 shortfall = H_TARGET_DAYS - h;                       // 1 … 110
        uint256 extra = ((MAX_FEE_BPS - SELL_FEE_MIN_BPS) * shortfall) / H_TARGET_DAYS;
        uint256 fee = SELL_FEE_MIN_BPS + extra;
        return fee > MAX_FEE_BPS ? MAX_FEE_BPS : fee;
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

    /// @notice Move to the next phase if its condition is met. Permissionless: it verifies
    ///         the condition on-chain, so there is no operator switch anywhere.
    function advancePhase() external {
        Phase from = phase;
        if (phase == Phase.Bootstrap && poolAgeDays() >= SELL_OPEN_DAY) {
            phase = Phase.TwoWay;
        } else if (phase == Phase.TwoWay && reserveUsdt >= LISTING_THRESHOLD) {
            phase = Phase.Listed;
        } else {
            revert("LP6: condition not met");
        }
        emit PhaseAdvanced(from, phase);
    }

    // ─────────────────────────────────────────────────────────
    // Inbound
    // ─────────────────────────────────────────────────────────

    /// @notice Seed MIC into the pool. Used once at launch from ListingReserveVault.
    function seedMic(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(amount > 0, "LP6: zero amount");

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
    ///         taking MIC out, so it raises coverage and the price together.
    function receiveUSDT(uint256 amount) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        // USDT arriving before the MIC would set the opening price above the published
        // $0.01, because the price is reserve over MIC and there is no MIC yet.
        require(startTime != 0, "LP6: pool not seeded");
        require(amount > 0, "LP6: zero amount");
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

    /// @notice Buy MIC with USDT.
    /// @param minMicOut Slippage guard — the transaction reverts below this.
    function swapUsdtToMic(uint256 usdtIn, uint256 minMicOut)
        external nonReentrant returns (uint256 micOut)
    {
        require(startTime != 0, "LP6: pool not seeded");
        require(usdtIn > 0, "LP6: zero amount");
        require(_lastTradeBlock[msg.sender] != block.number, "LP6: same block");
        _accrue();

        uint256 fee = (usdtIn * BUY_FEE_BPS) / BPS;
        uint256 inNet = usdtIn - fee;

        // The curve must be evaluated at the effective reserve that will actually exist,
        // not at "current + net in". Adding USDT also retires virtual reserve, so during
        // the retirement phase the effective side moves by only half of what comes in.
        // Pricing against the naive sum hands out too much MIC and leaks value on every buy.
        uint256 k = effectiveUsdt() * reserveMic;
        uint256 newEff = _effectiveAt(reserveUsdt + inNet);
        micOut = reserveMic - (k / newEff);

        require(micOut >= minMicOut, "LP6: slippage");
        require(micOut > 0, "LP6: zero out");
        require(micOut <= (reserveMic * MAX_TRADE_BPS) / BPS, "LP6: trade too large");

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
        require(startTime != 0, "LP6: pool not seeded");
        require(phase != Phase.Bootstrap, "LP6: sells not open");
        require(micIn > 0, "LP6: zero amount");
        require(_lastTradeBlock[msg.sender] != block.number, "LP6: same block");
        require(micIn <= (reserveMic * MAX_TRADE_BPS) / BPS, "LP6: trade too large");
        _accrue();

        uint256 k = effectiveUsdt() * reserveMic;
        uint256 newMic = reserveMic + micIn;
        uint256 targetEff = k / newMic;
        uint256 gross = effectiveUsdt() > targetEff ? effectiveUsdt() - targetEff : 0;

        uint256 feeBps = sellFeeBps();
        uint256 fee = (gross * feeBps) / BPS;
        usdtOut = gross - fee;

        require(usdtOut >= minUsdtOut, "LP6: slippage");
        _checkAndBookOutflow(usdtOut);

        // The curve can quote more than the pool actually holds, because part of the
        // reserve is virtual. This is the hard stop on that.
        require(usdtOut <= usdt.balanceOf(address(this)), "LP6: insufficient balance");
        require(usdtOut <= reserveUsdt, "LP6: insufficient reserve");

        mic.safeTransferFrom(msg.sender, address(this), micIn);
        reserveMic  += micIn;
        reserveUsdt -= usdtOut;      // the fee portion stays behind
        totalFeesCollected += fee;
        _lastTradeBlock[msg.sender] = block.number;

        usdt.safeTransfer(msg.sender, usdtOut);
        emit Sold(msg.sender, micIn, usdtOut, feeBps);
    }

    /// @dev Rolling 24-hour cap on outbound USDT.
    function _checkAndBookOutflow(uint256 amount) internal {
        if (block.timestamp >= windowStart + DAY) {
            windowStart = block.timestamp;
            usdtOutInWindow = 0;
        }
        uint256 cap = (reserveUsdt * DAILY_OUT_BPS) / BPS;
        require(usdtOutInWindow + amount <= cap, "LP6: daily cap");
        usdtOutInWindow += amount;
    }

    // ─────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────

    function quoteBuy(uint256 usdtIn) external view returns (uint256) {
        if (usdtIn == 0 || reserveMic == 0) return 0;
        uint256 inNet = usdtIn - (usdtIn * BUY_FEE_BPS) / BPS;
        uint256 k = effectiveUsdt() * reserveMic;
        return reserveMic - (k / _effectiveAt(reserveUsdt + inNet));
    }

    function quoteSell(uint256 micIn) external view returns (uint256) {
        if (micIn == 0 || reserveMic == 0) return 0;
        uint256 k = effectiveUsdt() * reserveMic;
        uint256 gross = effectiveUsdt() - (k / (reserveMic + micIn));
        return gross - (gross * sellFeeBps()) / BPS;
    }

    function remainingDailyOut() external view returns (uint256) {
        uint256 cap = (reserveUsdt * DAILY_OUT_BPS) / BPS;
        if (block.timestamp >= windowStart + DAY) return cap;
        return usdtOutInWindow >= cap ? 0 : cap - usdtOutInWindow;
    }
}
