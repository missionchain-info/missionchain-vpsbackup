// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMICToken {
    function mintFromMining(address to, uint256 amount) external;
    function remainingMiningPool() external view returns (uint256);
}

interface IMICELicenseReader {
    function activeLicenses() external view returns (uint256);
}

/// @dev The miner pool streams its share over 24 hours instead of crediting it at once,
///      so it has to be told what arrived. Minting alone is silent.
interface IMiningPoolNotify {
    function notifyReward(uint256 amount) external;
}

interface ILiquidityPoolV6Reader {
    function reserveUsdt() external view returns (uint256);
    function twap7d() external view returns (uint256);
    function twap30d() external view returns (uint256);
    function reportDailyEmission(uint256 avg7d) external;
}

/// @title EmissionController — Adaptive Emission Engine
/// @notice E(t) = E_base(t) × D(t) × L(H) × G × W(t) × A(N), daily mint to 5 pools.
///
///         This is the Emission layer. It reads liquidity state from LiquidityPoolV6 and
///         active-licence count from MICELicense, and never the other way round.
///
///         Issuance is controlled, price is not. Two independent brakes:
///           L(H) — liquidity coverage. How many days of issuance the pool could absorb.
///           G    — price trend. 7-day average against 30-day average, capped at 1.0.
///
///         L and G are NOT redundant. H measures the pool's capacity, not the health of
///         the price, and the two move in opposite directions when price falls: cheaper
///         MIC makes each day of issuance worth less, so coverage RISES. L alone would
///         therefore accelerate issuance into a falling market. G exists for that reason
///         and is part of the launch scope, not a later addition.
///
/// @dev Only mints when activeMICE > 0. Has MINTER_ROLE on MICToken.
contract EmissionController is AccessControl, ReentrancyGuard {

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    IMICToken public immutable micToken;
    IMICELicenseReader public immutable miceLicense;

    // Emission parameters
    /// @notice Ceiling issuance rate at t=0. Recalibrated 2026-08-05 from 22,907,500/day.
    ///         The old figure pushed ~94% of the 5.95B mining allocation into the first two
    ///         years — precisely when liquidity is thinnest — so the regulator would have
    ///         sat pinned at its floor forever and still over-issued. The allocation is a
    ///         maximum, not a target: at this rate roughly 3.16B is ever issued.
    uint256 public constant E0 = 750_000 ether;
    uint256 public constant HALF_LIFE = 2922 days;   // 8 years
    uint256 public constant MAX_MICE = 100_000;

    // Pool split — adjustable by ADMIN within ±10% of original.
    // Canonical split (Whitepaper / Deck p.7 "% OF MINING"): 59 / 25 / 10 / 5 / 1 = 100%
    uint256 public minersBps         = 5900; // 59% default
    uint256 public stakingBps        = 2500; // 25% default
    uint256 public daoBps            = 1000; // 10% default
    uint256 public communityNFTBps   = 500;  // 5% default
    uint256 public mfpRewardBps      = 100;  // 1% default

    // Original values for ±10% constraint enforcement
    uint256 public constant ORIG_MINERS        = 5900;
    uint256 public constant ORIG_STAKING       = 2500;
    uint256 public constant ORIG_DAO           = 1000;
    uint256 public constant ORIG_COMMUNITY_NFT = 500;
    uint256 public constant ORIG_MFP_REWARD    = 100;
    uint256 public constant MAX_DEVIATION_BPS  = 1000; // ±10%

    // Pool addresses
    address public miningPool;
    address public stakingPool;
    address public daoTreasury;
    address public communityNFTPool;
    address public mfpRewardPool;

    // State
    uint256 public deployTime;
    uint256 public lastDistribution;
    uint256 public totalEmitted;

    // Oracle-fed values
    /// @notice Liquidity pool supplying coverage and price-trend inputs.
    ILiquidityPoolV6Reader public liquidityPool;

    /// @notice Current liquidity regulator, 1e18 scale. Moves at most ±10% per day so it
    ///         adjusts gradually rather than in steps.
    uint256 public currentL;
    uint256 public lastLUpdate;

    /// @notice Trailing 7-day average of actual issuance, used to compute coverage and
    ///         reported to the pool each day.
    uint256[7] public recentEmissions;
    uint256 public emissionIndex;
    uint256 public emissionSamples;

    /// @notice Coverage target, in days.
    uint256 public constant H_TARGET_DAYS = 110;
    uint256 public constant L_MIN = 2e16;    // 0.02
    uint256 public constant L_MAX = 2e18;    // 2.00
    uint256 public constant L_STEP_BPS = 1000;   // ±10% per day

    /// @notice Adoption ramp reference. Below this many active licences, issuance is
    ///         scaled down so a handful of early participants cannot draw the full rate.
    uint256 public constant ADOPTION_REF = 10_000;

    /// @notice Emergency brake: if the 7-day average falls below this share of the pool's
    ///         opening reference price, L is held at its floor until it recovers.
    uint256 public constant BRAKE_BPS = 5000;    // 50%
    /// @notice Pool opening reference price, set once at wiring time.
    uint256 public openingPrice;

    event DailyDistributed(
        uint256 day,
        uint256 totalMinted,
        uint256 toMiners,
        uint256 toStaking,
        uint256 toDAO,
        uint256 toCommunityNFT,
        uint256 toMFPReward
    );
    event RegulatorUpdated(uint256 currentL, uint256 targetL, uint256 coverageDays);
    event LiquidityPoolSet(address pool, uint256 openingPrice);
    event SplitRatiosUpdated(
        uint256 miners,
        uint256 staking,
        uint256 dao,
        uint256 communityNFT,
        uint256 mfpReward
    );

    constructor(
        address _micToken,
        address _miceLicense,
        address _miningPool,
        address _stakingPool,
        address _daoTreasury,
        address _communityNFTPool,
        address _mfpRewardPool,
        address admin
    ) {
        require(_micToken != address(0) && _miceLicense != address(0), "EC: zero address");
        micToken = IMICToken(_micToken);
        miceLicense = IMICELicenseReader(_miceLicense);
        miningPool = _miningPool;
        stakingPool = _stakingPool;
        daoTreasury = _daoTreasury;
        communityNFTPool = _communityNFTPool;
        mfpRewardPool = _mfpRewardPool;

        deployTime = block.timestamp;
        lastDistribution = block.timestamp;
        currentL = L_MIN;   // starts at the floor and ramps up as coverage builds
        lastLUpdate = block.timestamp;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ORACLE_ROLE, admin);
    }

    /// @notice Calculate E_base(t) using piecewise linear approximation of exponential decay
    /// @dev E_base(t) = E₀ × e^(−λt), approximated with halving every HALF_LIFE
    function eBase() public view returns (uint256) {
        uint256 elapsed = block.timestamp - deployTime;
        // Number of half-lives elapsed (integer part)
        uint256 halvings = elapsed / HALF_LIFE;
        uint256 remainder = elapsed % HALF_LIFE;

        if (halvings >= 20) return 0; // ~160 years at an 8-year half-life

        // E₀ >> halvings for integer half-lives
        uint256 base = E0 >> halvings;

        // Linear interpolation for fractional half-life
        // Reduce by (remainder / HALF_LIFE) * 50% of current base
        uint256 fractionalDecay = (base * remainder) / (HALF_LIFE * 2);
        return base - fractionalDecay;
    }

    /// @notice Demand factor D(t) = 0.5 + U(t), where U = activeMICE / 100,000
    /// @return D in 1e18 scale (0.5e18 to 1.5e18)
    function demandFactor() public view returns (uint256) {
        uint256 active = miceLicense.activeLicenses();
        // D = 0.5 + active/MAX_MICE, scaled to 1e18
        // 0.5e18 + (active * 1e18 / MAX_MICE)
        return 5e17 + (active * 1e18) / MAX_MICE;
    }

    /// @notice Liquidity coverage H, in DAYS: how many days of issuance the pool's real
    ///         USDT could absorb at the 7-day average price.
    /// @dev    Capacity, not price health. See the contract header for why G exists.
    function coverageH() public view returns (uint256) {
        if (address(liquidityPool) == address(0)) return 0;
        uint256 avg = avgDailyEmission();
        if (avg == 0) {
            // No issuance history yet: measure against the undamped schedule rather than
            // dividing by zero, so the first days start from something real.
            avg = (eBase() * demandFactor()) / 1e18;
        }
        uint256 px = liquidityPool.twap7d();
        if (avg == 0 || px == 0) return 0;
        uint256 dailyValue = (avg * px) / 1e18;           // USDT 6-dec
        if (dailyValue == 0) return 0;
        return liquidityPool.reserveUsdt() / dailyValue;
    }

    /// @notice Target regulator implied by current coverage, before the daily rate limit.
    function targetL() public view returns (uint256) {
        uint256 t = (coverageH() * 1e18) / H_TARGET_DAYS;
        if (t < L_MIN) return L_MIN;
        if (t > L_MAX) return L_MAX;
        return t;
    }

    /// @notice Price trend damper. Capped at 1.0, so it can only slow issuance, never
    ///         accelerate it. A falling 7-day average against the 30-day average reduces
    ///         issuance in proportion.
    function trendFactor() public view returns (uint256) {
        if (address(liquidityPool) == address(0)) return 1e18;
        uint256 a = liquidityPool.twap7d();
        uint256 b = liquidityPool.twap30d();
        if (a == 0 || b == 0) return 1e18;
        uint256 g = (a * 1e18) / b;
        if (g > 1e18) return 1e18;      // never boosts
        if (g < 25e16) return 25e16;    // floor 0.25
        return g;
    }

    /// @notice True when the 7-day average has fallen below half the pool's opening
    ///         reference price. Engages and releases on its own; there is no switch.
    function brakeEngaged() public view returns (bool) {
        if (address(liquidityPool) == address(0) || openingPrice == 0) return false;
        return liquidityPool.twap7d() < (openingPrice * BRAKE_BPS) / 10000;
    }

    /// @notice Adoption ramp A(N) = min(1, sqrt(N / 10,000)), 1e18 scale. Keeps early
    ///         issuance proportionate to how many licences are actually mining.
    function adoptionFactor() public view returns (uint256) {
        uint256 nActive = miceLicense.activeLicenses();
        if (nActive >= ADOPTION_REF) return 1e18;
        return _sqrt((nActive * 1e36) / ADOPTION_REF);
    }

    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    /// @notice Trailing 7-day average of actual issuance.
    function avgDailyEmission() public view returns (uint256) {
        if (emissionSamples == 0) return 0;
        uint256 sum;
        uint256 count = emissionSamples < 7 ? emissionSamples : 7;
        for (uint256 i = 0; i < count; i++) sum += recentEmissions[i];
        return sum / count;
    }

    /// @notice WarmUp factor W(t) = min(1.0, t / 30 days)
    /// @return W in 1e18 scale (0 at t=0, ramps linearly to 1e18 at t=30 days)
    function warmUpFactor() public view returns (uint256) {
        uint256 elapsed = block.timestamp - deployTime;
        uint256 thirtyDays = 30 days;
        if (elapsed >= thirtyDays) return 1e18;
        return (elapsed * 1e18) / thirtyDays;
    }

    /// @notice Dynamic miner BPS for Early Staking Boost (first 90 days)
    /// @dev MinerPct(t) = minersBps - max(0, (90-daysElapsed)/90 * 1000)
    ///      Day 0: 4900 BPS (49%), Day 90+: 5900 BPS (59%). The 1000 BPS given up
    ///      by miners in the ramp is absorbed by Staking (see distributeDaily).
    function _currentMinerBps() internal view returns (uint256) {
        uint256 elapsed = block.timestamp - deployTime;
        uint256 ninetyDays = 90 days;
        if (elapsed >= ninetyDays) return minersBps;
        uint256 daysElapsed = elapsed / 1 days;
        // boost = (90 - daysElapsed) * 1000 / 90
        uint256 boost = ((90 - daysElapsed) * 1000) / 90;
        return minersBps - boost;
    }

    /// @notice Calculate today's emission E(t) = E_base × D(t) × R(t) × W(t)
    function dailyEmission() public view returns (uint256) {
        uint256 active = miceLicense.activeLicenses();
        if (active == 0) return 0; // CRITICAL: no miners = no emission

        uint256 base = eBase();
        uint256 d = demandFactor();
        uint256 l = brakeEngaged() ? L_MIN : currentL;
        uint256 g = trendFactor();
        uint256 w = warmUpFactor();
        uint256 a = adoptionFactor();

        // E = base × D × L × G × W × A (D, L, G, W, A all 1e18 scale)
        uint256 emission = base;
        emission = emission * d / 1e18;
        emission = emission * l / 1e18;
        emission = emission * g / 1e18;
        emission = emission * w / 1e18;
        emission = emission * a / 1e18;

        // Circuit breaker: daily cap = 2 × E_base
        uint256 dailyCap = base * 2;
        if (emission > dailyCap) emission = dailyCap;

        // Circuit breaker: cumulative cap
        uint256 remaining = micToken.remainingMiningPool();
        if (emission > remaining) emission = remaining;

        return emission;
    }

    /// @notice Distribute daily emission to 5 pools. Callable once per day.
    function distributeDaily() external nonReentrant {
        require(block.timestamp >= lastDistribution + 1 days, "EC: too early");
        _updateL();

        uint256 emission = dailyEmission();
        if (emission == 0) {
            lastDistribution = block.timestamp;
            return;
        }

        lastDistribution = block.timestamp;
        totalEmitted += emission;

        // Early Staking Boost: dynamic miner/staking split for first 90 days
        // Staking absorbs what miners give up (DAO, Community NFT and MFP Reward unchanged)
        uint256 currentMiners  = _currentMinerBps();
        uint256 currentStaking = stakingBps + (minersBps - currentMiners);

        // Split to 5 pools. Community NFT takes the remainder so dust never strands.
        uint256 toMiners        = (emission * currentMiners)  / 10000;
        uint256 toStaking       = (emission * currentStaking) / 10000;
        uint256 toDAO           = (emission * daoBps)         / 10000;
        uint256 toMFPReward     = (emission * mfpRewardBps)   / 10000;
        uint256 toCommunityNFT  = emission - toMiners - toStaking - toDAO - toMFPReward;

        // Mint to each pool
        // Mint first, then announce: `notifyReward` checks the pool is actually funded
        // for what it is about to promise, and that check must see the new MIC.
        if (toMiners > 0) {
            micToken.mintFromMining(miningPool, toMiners);
            IMiningPoolNotify(miningPool).notifyReward(toMiners);
        }
        if (toStaking > 0)      micToken.mintFromMining(stakingPool, toStaking);
        if (toDAO > 0)          micToken.mintFromMining(daoTreasury, toDAO);
        if (toMFPReward > 0)    micToken.mintFromMining(mfpRewardPool, toMFPReward);
        if (toCommunityNFT > 0) micToken.mintFromMining(communityNFTPool, toCommunityNFT);

        // Record actual issuance and hand the 7-day average to the pool, which needs it
        // to price its own sell fee. This is the Emission layer informing the Liquidity
        // layer of a fact it owns — the read direction stays Emission → Liquidity.
        recentEmissions[emissionIndex] = emission;
        emissionIndex = (emissionIndex + 1) % 7;
        if (emissionSamples < 7) emissionSamples += 1;
        if (address(liquidityPool) != address(0)) {
            liquidityPool.reportDailyEmission(avgDailyEmission());
        }

        uint256 day = (block.timestamp - deployTime) / 1 days;
        emit DailyDistributed(day, emission, toMiners, toStaking, toDAO, toCommunityNFT, toMFPReward);
    }

    // --- Oracle updates ---

    /// @dev Moves the regulator toward its target, at most ±10% per day. Gradual by
    ///      design: a step change in issuance would be its own kind of shock.
    function _updateL() internal {
        if (address(liquidityPool) == address(0)) return;
        uint256 elapsedDays = (block.timestamp - lastLUpdate) / 1 days;
        if (elapsedDays == 0) return;
        uint256 target = targetL();
        uint256 cur = currentL;
        for (uint256 i = 0; i < elapsedDays && i < 30; i++) {
            uint256 up = cur + (cur * L_STEP_BPS) / 10000;
            uint256 down = cur - (cur * L_STEP_BPS) / 10000;
            if (target > cur) cur = target < up ? target : up;
            else if (target < cur) cur = target > down ? target : down;
            else break;
        }
        if (cur < L_MIN) cur = L_MIN;
        if (cur > L_MAX) cur = L_MAX;
        currentL = cur;
        lastLUpdate = block.timestamp;
        emit RegulatorUpdated(cur, target, coverageH());
    }

    /// @notice Anyone may advance the regulator between distributions.
    function pokeRegulator() external { _updateL(); }

    // --- Admin ---

    /// @notice Wire the liquidity pool and record its opening reference price. The
    ///         opening price anchors the emergency brake, so it is set once and then
    ///         frozen — a movable anchor would make the brake meaningless.
    function setLiquidityPool(address _pool, uint256 _openingPrice)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_pool != address(0), "EC: zero address");
        require(_openingPrice > 0, "EC: zero opening price");
        require(openingPrice == 0, "EC: already set");
        liquidityPool = ILiquidityPoolV6Reader(_pool);
        openingPrice = _openingPrice;
        lastLUpdate = block.timestamp;
        emit LiquidityPoolSet(_pool, _openingPrice);
    }

    function setMiningPool(address _pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_pool != address(0), "EC: zero address");
        miningPool = _pool;
    }

    function setStakingPool(address _pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_pool != address(0), "EC: zero address");
        stakingPool = _pool;
    }

    function setDaoTreasury(address _dao) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_dao != address(0), "EC: zero address");
        daoTreasury = _dao;
    }

    function setCommunityNFTPool(address _pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_pool != address(0), "EC: zero address");
        communityNFTPool = _pool;
    }

    function setMfpRewardPool(address _pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_pool != address(0), "EC: zero address");
        mfpRewardPool = _pool;
    }

    /// @notice Adjust emission split ratios within ±10% of original values
    /// @param _miners Miners pool BPS
    /// @param _staking Staking pool BPS
    /// @param _dao DAO treasury BPS
    /// @param _communityNFT Community NFT Reward BPS
    /// @param _mfpReward MFP-NFT Reward BPS
    function setSplitRatios(
        uint256 _miners,
        uint256 _staking,
        uint256 _dao,
        uint256 _communityNFT,
        uint256 _mfpReward
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Must sum to 100%
        require(
            _miners + _staking + _dao + _communityNFT + _mfpReward == 10000,
            "EC: must total 100%"
        );

        // Each must be within ±10% (1000 BPS) of original
        require(
            _miners >= (ORIG_MINERS > MAX_DEVIATION_BPS ? ORIG_MINERS - MAX_DEVIATION_BPS : 0) &&
            _miners <= ORIG_MINERS + MAX_DEVIATION_BPS,
            "EC: miners out of range"
        );
        require(
            _staking >= (ORIG_STAKING > MAX_DEVIATION_BPS ? ORIG_STAKING - MAX_DEVIATION_BPS : 0) &&
            _staking <= ORIG_STAKING + MAX_DEVIATION_BPS,
            "EC: staking out of range"
        );
        require(
            _dao >= (ORIG_DAO > MAX_DEVIATION_BPS ? ORIG_DAO - MAX_DEVIATION_BPS : 0) &&
            _dao <= ORIG_DAO + MAX_DEVIATION_BPS,
            "EC: dao out of range"
        );
        require(
            _communityNFT <= ORIG_COMMUNITY_NFT + MAX_DEVIATION_BPS,
            "EC: communityNFT out of range"
        );
        require(
            _mfpReward <= ORIG_MFP_REWARD + MAX_DEVIATION_BPS,
            "EC: mfpReward out of range"
        );

        minersBps        = _miners;
        stakingBps       = _staking;
        daoBps           = _dao;
        communityNFTBps  = _communityNFT;
        mfpRewardBps     = _mfpReward;

        emit SplitRatiosUpdated(_miners, _staking, _dao, _communityNFT, _mfpReward);
    }
}
