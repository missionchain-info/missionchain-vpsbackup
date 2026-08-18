// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMICTokenV2 {
    function mintFromMining(address to, uint256 amount) external;
    function remainingMiningPool() external view returns (uint256);
}

/// @dev The miner pool both counts the miners and receives their share. `totalActive` is
///      the only count in the system that retires a licence at its expiry second; the
///      licence contract's own `activeLicenses` only drops when somebody calls `recycle`,
///      so it counts the dead alongside the living. V1 read that one and over-issued.
interface IMiningPoolV2 {
    function notifyReward(uint256 amount) external;
    function totalActive() external view returns (uint256);
    function pendingExpiries() external view returns (uint256);
    function sync() external;
}

interface IEmissionReportTarget {
    function reportDailyEmission(uint256 avg7d) external;
}

/// @title EmissionControllerV2 — proportional mining emission
///
/// @notice One rule:
///
///             every active licence earns the same MIC per day.
///
///         `E = N × r ÷ minerShare × damper`, minted daily and split across five pools.
///         `E` rises and falls with `N`; each miner's share does not move when `N` moves.
///
/// @dev WHY THIS REPLACES V1
///
///      V1 computed `E = E_base × D × L × G × W × A`. Four of those six factors were
///      themselves functions of `N` or of time, and they multiplied:
///
///        A = √(N/10,000)   →  0.0045 at N=2
///        D = 0.5 + N/100k  →  0.5 at N=2
///        W = min(1, t/30)  →  cut the earliest buyers, who carry the most risk
///        L = clamp(H/110)  →  pinned at its 0.02 floor, permanently: it read reserveUsdt
///                             from LiquidityPoolV6 ($10) and `setLiquidityPool` is frozen
///                             by `require(openingPrice == 0)`, so it can never be repointed
///
///      Their product was roughly 1/24,000. Worse, A made each licence earn LESS as more
///      joined — the opposite of what a proportional reward must do. V1 never distributed
///      anything on mainnet (`totalEmitted == 0`), so nothing is owed and nothing is lost.
///
/// @dev WHY THERE IS NO PRICE ORACLE HERE
///
///      An earlier draft set `r = pricePaid ÷ price ÷ 120` so every round paid back in 120
///      days regardless of the MIC price. That put the price risk on the protocol: at
///      $0.001 the obligation grows to 58B MIC against a 5.95B pool, and a falling price
///      would raise issuance, which lowers the price. A spiral.
///
///      The rule adopted instead is that every licence receives the same MIC. Round n costs
///      n × $100 because MIC is EXPECTED at n × $0.01 — if that does not happen, the buyer
///      waits longer. The obligation is therefore a fixed quantity of MIC, independent of
///      price, and no oracle appears anywhere in the reward path.
///
/// @dev WHY THERE IS NO LIFETIME CAP PARAMETER
///
///      83.3333 MIC/day × the licence's own 360-day term = 30,000 MIC. Across the full
///      100,000 licences that is 3.0B to miners, 5.08B issued, against a 5.95B pool —
///      it fits with 0.87B to spare. The term already is the cap. A separate cap would
///      only cut the term short and strand the rest of the pool.
contract EmissionControllerV2 is AccessControl, ReentrancyGuard {

    // ─────────────────────────────────────────────────────────
    // Immutable wiring
    // ─────────────────────────────────────────────────────────

    IMICTokenV2 public immutable micToken;

    /// @notice Counts the miners AND receives their share. Same contract, two jobs.
    IMiningPoolV2 public miningPool;

    address public stakingPool;
    address public daoTreasury;
    address public communityNFTPool;
    address public mfpRewardPool;

    /// @notice Told the 7-day average purely as telemetry. Nothing reads it back, and a
    ///         missing role here must never block a distribution — see `_report`.
    address public emissionReportTarget;

    // ─────────────────────────────────────────────────────────
    // The rate — settable, because V1's undoing was that it was not
    // ─────────────────────────────────────────────────────────

    /// @notice MIC per active licence per day. Default 83.3333… = $100 ÷ $0.01 ÷ 120 days.
    /// @dev Round 1 costs $100 and MIC is referenced at $0.01, so 120 days of this rate
    ///      returns the licence price at that reference. Later rounds cost more because
    ///      MIC is expected to be worth more, and receive the same MIC.
    uint256 public micPerLicencePerDay = 83_333333333333333333;

    uint256 public constant RATE_MIN = 1 ether;
    uint256 public constant RATE_MAX = 500 ether;

    /// @notice Emergency brake, in bps. 10000 = inert. This is the ONLY discretionary
    ///         damper, it starts disengaged, and it is visible on chain. V1's brake sat
    ///         at its floor from day one and could not be released.
    uint256 public damperBps = 10000;
    uint256 public constant DAMPER_MIN_BPS = 2500;

    /// @notice MICELicense.MAX_SUPPLY. A hard clamp on N so a mis-set counter cannot mint
    ///         beyond the design ceiling, rather than an unrelated constant like `2 × E0`.
    uint256 public constant MAX_MICE = 100_000;

    /// @notice A keeper that misses days can make them up, so the daily rate survives an
    ///         outage. Bounded so a long silence cannot dump a quarter's issuance at once.
    uint256 public constant MAX_CATCHUP = 7 days;

    // ─────────────────────────────────────────────────────────
    // Pool split — unchanged from V1
    // ─────────────────────────────────────────────────────────

    uint256 public minersBps       = 5900;
    uint256 public stakingBps      = 2500;
    uint256 public daoBps          = 1000;
    uint256 public communityNFTBps = 500;
    uint256 public mfpRewardBps    = 100;

    uint256 public constant ORIG_MINERS        = 5900;
    uint256 public constant ORIG_STAKING       = 2500;
    uint256 public constant ORIG_DAO           = 1000;
    uint256 public constant ORIG_COMMUNITY_NFT = 500;
    uint256 public constant ORIG_MFP_REWARD    = 100;
    uint256 public constant MAX_DEVIATION_BPS  = 1000;

    /// @notice Early Staking Boost: miners start at 49% and ramp to 59% over 90 days,
    ///         staking absorbing the difference. Miners are still paid exactly `N × r`;
    ///         the boost only changes how much is issued to pay it.
    uint256 public constant BOOST_DAYS = 90;
    uint256 public constant BOOST_BPS  = 1000;

    // ─────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────

    uint256 public immutable deployTime;
    uint256 public lastDistribution;
    uint256 public totalEmitted;
    uint256 public totalToMiners;

    uint256[7] public recentEmissions;
    uint256 public emissionIndex;
    uint256 public emissionSamples;

    event DailyDistributed(
        uint256 day,
        uint256 activeLicences,
        uint256 elapsed,
        uint256 totalMinted,
        uint256 toMiners,
        uint256 toStaking,
        uint256 toDAO,
        uint256 toCommunityNFT,
        uint256 toMFPReward
    );
    event RateUpdated(uint256 oldRate, uint256 newRate);
    event DamperUpdated(uint256 oldBps, uint256 newBps);
    event SplitRatiosUpdated(uint256 miners, uint256 staking, uint256 dao, uint256 communityNFT, uint256 mfpReward);
    event PoolAddressUpdated(string what, address addr);
    event EmissionReportFailed(uint256 avg7d);

    constructor(
        address _micToken,
        address _miningPool,
        address _stakingPool,
        address _daoTreasury,
        address _communityNFTPool,
        address _mfpRewardPool,
        address admin
    ) {
        require(_micToken != address(0), "EC2: zero mic");
        require(_miningPool != address(0), "EC2: zero mining pool");
        require(_stakingPool != address(0), "EC2: zero staking pool");
        require(_daoTreasury != address(0), "EC2: zero dao");
        require(_communityNFTPool != address(0), "EC2: zero community pool");
        require(_mfpRewardPool != address(0), "EC2: zero mfp pool");
        require(admin != address(0), "EC2: zero admin");

        micToken         = IMICTokenV2(_micToken);
        miningPool       = IMiningPoolV2(_miningPool);
        stakingPool      = _stakingPool;
        daoTreasury      = _daoTreasury;
        communityNFTPool = _communityNFTPool;
        mfpRewardPool    = _mfpRewardPool;

        deployTime       = block.timestamp;
        lastDistribution = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ─────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────

    /// @notice Licences genuinely mining right now.
    /// @dev `totalActive` is only decremented when the pool syncs, so any expiry that has
    ///      fallen due but not yet been recorded is subtracted here. `distributeDaily`
    ///      calls `sync()` first and then this returns the settled figure anyway; this
    ///      subtraction is what makes the *view* honest between syncs.
    function activeLicences() public view returns (uint256) {
        uint256 total = miningPool.totalActive();
        uint256 due   = miningPool.pendingExpiries();
        uint256 n     = due >= total ? 0 : total - due;
        return n > MAX_MICE ? MAX_MICE : n;
    }

    /// @notice Miner share right now, in bps. Ramps 4900 → 5900 across the first 90 days.
    function currentMinerBps() public view returns (uint256) {
        uint256 elapsed = block.timestamp - deployTime;
        if (elapsed >= BOOST_DAYS * 1 days) return minersBps;
        uint256 daysElapsed = elapsed / 1 days;
        return minersBps - ((BOOST_DAYS - daysElapsed) * BOOST_BPS) / BOOST_DAYS;
    }

    /// @notice Seconds of issuance the next `distributeDaily` would pay for.
    function pendingElapsed() public view returns (uint256) {
        uint256 elapsed = block.timestamp - lastDistribution;
        return elapsed > MAX_CATCHUP ? MAX_CATCHUP : elapsed;
    }

    /// @notice What miners would receive for `elapsed` seconds at the current count.
    function minerAmountFor(uint256 n, uint256 elapsed) public view returns (uint256) {
        return (n * micPerLicencePerDay * elapsed) / 1 days;
    }

    /// @notice Total issuance for `elapsed` seconds — miners' share grossed up to 100%,
    ///         damped, then clipped to whatever the mining allocation has left.
    function emissionFor(uint256 n, uint256 elapsed) public view returns (uint256) {
        if (n == 0 || elapsed == 0) return 0;
        uint256 e = (minerAmountFor(n, elapsed) * 10000) / currentMinerBps();
        e = (e * damperBps) / 10000;
        uint256 remaining = micToken.remainingMiningPool();
        return e > remaining ? remaining : e;
    }

    /// @notice Issuance if `distributeDaily` were called now.
    function pendingEmission() public view returns (uint256) {
        return emissionFor(activeLicences(), pendingElapsed());
    }

    /// @notice Steady-state issuance per day at the current count.
    function dailyEmission() public view returns (uint256) {
        return emissionFor(activeLicences(), 1 days);
    }

    /// @notice Trailing average of actual issuance, normalised to a day.
    function avgDailyEmission() public view returns (uint256) {
        if (emissionSamples == 0) return 0;
        uint256 sum;
        for (uint256 i = 0; i < emissionSamples; i++) sum += recentEmissions[i];
        return sum / emissionSamples;
    }

    // ─────────────────────────────────────────────────────────
    // Distribution
    // ─────────────────────────────────────────────────────────

    /// @notice Mint one interval's issuance and split it across the five pools.
    /// @dev Permissionless and once-a-day. Missed days are made up, to a week.
    function distributeDaily() external nonReentrant {
        require(block.timestamp >= lastDistribution + 1 days, "EC2: too early");

        // Retire licences that have expired BEFORE counting them. Without this the pool
        // would pay for the dead until somebody happened to call sync.
        miningPool.sync();

        uint256 elapsed = pendingElapsed();
        uint256 n       = activeLicences();
        uint256 emission = emissionFor(n, elapsed);

        lastDistribution = block.timestamp;
        if (emission == 0) return;

        totalEmitted += emission;

        uint256 curMiners  = currentMinerBps();
        uint256 curStaking = stakingBps + (minersBps - curMiners);

        uint256 toMiners       = (emission * curMiners)   / 10000;
        uint256 toStaking      = (emission * curStaking)  / 10000;
        uint256 toDAO          = (emission * daoBps)      / 10000;
        uint256 toMFPReward    = (emission * mfpRewardBps)/ 10000;
        // Community NFT takes the remainder so integer dust never strands.
        uint256 toCommunityNFT = emission - toMiners - toStaking - toDAO - toMFPReward;

        totalToMiners += toMiners;

        // Mint before announcing: `notifyReward` checks the pool actually holds what it
        // is about to promise, and that check must see the new MIC.
        if (toMiners > 0) {
            micToken.mintFromMining(address(miningPool), toMiners);
            miningPool.notifyReward(toMiners);
        }
        if (toStaking > 0)      micToken.mintFromMining(stakingPool, toStaking);
        if (toDAO > 0)          micToken.mintFromMining(daoTreasury, toDAO);
        if (toMFPReward > 0)    micToken.mintFromMining(mfpRewardPool, toMFPReward);
        if (toCommunityNFT > 0) micToken.mintFromMining(communityNFTPool, toCommunityNFT);

        // Normalise to a day before recording, so a catch-up call does not distort the average.
        recentEmissions[emissionIndex] = (emission * 1 days) / elapsed;
        emissionIndex = (emissionIndex + 1) % 7;
        if (emissionSamples < 7) emissionSamples += 1;
        _report(avgDailyEmission());

        emit DailyDistributed(
            (block.timestamp - deployTime) / 1 days,
            n, elapsed, emission,
            toMiners, toStaking, toDAO, toCommunityNFT, toMFPReward
        );
    }

    /// @dev Telemetry only. If the role was never granted, or the target is a contract that
    ///      reverts, the distribution still stands — miners are not held hostage to a log.
    function _report(uint256 avg7d) private {
        address t = emissionReportTarget;
        if (t == address(0)) return;
        try IEmissionReportTarget(t).reportDailyEmission(avg7d) {} catch {
            emit EmissionReportFailed(avg7d);
        }
    }

    // ─────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────

    function setMicPerLicencePerDay(uint256 rate) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(rate >= RATE_MIN && rate <= RATE_MAX, "EC2: rate out of range");
        emit RateUpdated(micPerLicencePerDay, rate);
        micPerLicencePerDay = rate;
    }

    function setDamperBps(uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bps >= DAMPER_MIN_BPS && bps <= 10000, "EC2: damper out of range");
        emit DamperUpdated(damperBps, bps);
        damperBps = bps;
    }

    function setMiningPool(address p) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(p != address(0), "EC2: zero address");
        miningPool = IMiningPoolV2(p);
        emit PoolAddressUpdated("miningPool", p);
    }

    function setStakingPool(address p) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(p != address(0), "EC2: zero address");
        stakingPool = p;
        emit PoolAddressUpdated("stakingPool", p);
    }

    function setDaoTreasury(address p) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(p != address(0), "EC2: zero address");
        daoTreasury = p;
        emit PoolAddressUpdated("daoTreasury", p);
    }

    function setCommunityNFTPool(address p) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(p != address(0), "EC2: zero address");
        communityNFTPool = p;
        emit PoolAddressUpdated("communityNFTPool", p);
    }

    function setMfpRewardPool(address p) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(p != address(0), "EC2: zero address");
        mfpRewardPool = p;
        emit PoolAddressUpdated("mfpRewardPool", p);
    }

    /// @notice May be set to the zero address to switch telemetry off.
    function setEmissionReportTarget(address t) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emissionReportTarget = t;
        emit PoolAddressUpdated("emissionReportTarget", t);
    }

    /// @notice Adjust the five-way split, each leg within ±10% of its published value.
    function setSplitRatios(
        uint256 _miners,
        uint256 _staking,
        uint256 _dao,
        uint256 _communityNFT,
        uint256 _mfpReward
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_miners + _staking + _dao + _communityNFT + _mfpReward == 10000, "EC2: must total 100%");
        require(_miners >= ORIG_MINERS - MAX_DEVIATION_BPS && _miners <= ORIG_MINERS + MAX_DEVIATION_BPS, "EC2: miners out of range");
        require(_staking >= ORIG_STAKING - MAX_DEVIATION_BPS && _staking <= ORIG_STAKING + MAX_DEVIATION_BPS, "EC2: staking out of range");
        require(_dao >= ORIG_DAO - MAX_DEVIATION_BPS && _dao <= ORIG_DAO + MAX_DEVIATION_BPS, "EC2: dao out of range");
        require(_communityNFT <= ORIG_COMMUNITY_NFT + MAX_DEVIATION_BPS, "EC2: communityNFT out of range");
        require(_mfpReward <= ORIG_MFP_REWARD + MAX_DEVIATION_BPS, "EC2: mfpReward out of range");

        // The boost subtracts BOOST_BPS from miners for 90 days; miners must stay solvent.
        require(_miners > BOOST_BPS, "EC2: miners below boost floor");

        minersBps       = _miners;
        stakingBps      = _staking;
        daoBps          = _dao;
        communityNFTBps = _communityNFT;
        mfpRewardBps    = _mfpReward;

        emit SplitRatiosUpdated(_miners, _staking, _dao, _communityNFT, _mfpReward);
    }
}
