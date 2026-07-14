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

/// @title EmissionController — Adaptive Emission Engine
/// @notice E(t) = E_base(t) × D(t) × R(t) × W(t), daily mint to 4 pools
/// @dev Only mints when activeMICE > 0. Has MINTER_ROLE on MICToken.
contract EmissionController is AccessControl, ReentrancyGuard {

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    IMICToken public immutable micToken;
    IMICELicenseReader public immutable miceLicense;

    // Emission parameters
    uint256 public constant E0 = 22_907_500 ether;  // E₀ = 22,907,500 MIC/day
    uint256 public constant HALF_LIFE = 180 days;    // T_half = 180 days
    uint256 public constant MAX_MICE = 100_000;

    // Pool split — adjustable by ADMIN within ±10% of original
    uint256 public minersBps         = 6000; // 60% default
    uint256 public stakingBps        = 2500; // 25% default
    uint256 public daoBps            = 1000; // 10% default
    uint256 public communityNFTBps   = 500;  // 5% default

    // Original values for ±10% constraint enforcement
    uint256 public constant ORIG_MINERS        = 6000;
    uint256 public constant ORIG_STAKING       = 2500;
    uint256 public constant ORIG_DAO           = 1000;
    uint256 public constant ORIG_COMMUNITY_NFT = 500;
    uint256 public constant MAX_DEVIATION_BPS  = 1000; // ±10%

    // Pool addresses
    address public miningPool;
    address public stakingPool;
    address public daoTreasury;
    address public communityNFTPool;

    // State
    uint256 public deployTime;
    uint256 public lastDistribution;
    uint256 public totalEmitted;

    // Oracle-fed values
    uint256 public currentROI;  // ROI in basis points (e.g., 25000 = 250%)

    // Circuit breaker: price floor
    bool public priceFloorBreached;

    event DailyDistributed(
        uint256 day,
        uint256 totalMinted,
        uint256 toMiners,
        uint256 toStaking,
        uint256 toDAO,
        uint256 toCommunityNFT
    );
    event ROIUpdated(uint256 oldROI, uint256 newROI);
    event PriceFloorToggled(bool breached);
    event SplitRatiosUpdated(uint256 miners, uint256 staking, uint256 dao, uint256 communityNFT);

    constructor(
        address _micToken,
        address _miceLicense,
        address _miningPool,
        address _stakingPool,
        address _daoTreasury,
        address _communityNFTPool,
        address admin
    ) {
        require(_micToken != address(0) && _miceLicense != address(0), "EC: zero address");
        micToken = IMICToken(_micToken);
        miceLicense = IMICELicenseReader(_miceLicense);
        miningPool = _miningPool;
        stakingPool = _stakingPool;
        daoTreasury = _daoTreasury;
        communityNFTPool = _communityNFTPool;

        deployTime = block.timestamp;
        lastDistribution = block.timestamp;
        currentROI = 25000; // default 250% ROI

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

        if (halvings >= 20) return 0; // essentially zero after ~10 years

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

    /// @notice ROI regulator R(t) = clamp(250% / ROI, 0.5, 2.0)
    /// @return R in 1e18 scale
    function roiFactor() public view returns (uint256) {
        if (currentROI == 0) return 2e18; // max if no ROI data
        // R = 25000 / currentROI (both in BPS), then scale to 1e18
        uint256 r = (25000 * 1e18) / currentROI;
        if (r < 5e17) return 5e17;   // min 0.5
        if (r > 2e18) return 2e18;   // max 2.0
        return r;
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
    /// @dev MinerPct(t) = 6000 - max(0, (90-daysElapsed)/90 * 1000)
    ///      Day 0: 5000 BPS (50%), Day 90+: 6000 BPS (60%)
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
        uint256 r = roiFactor();
        uint256 w = warmUpFactor();

        // E = base × D × R × W / 1e54 (since D, R, W are all in 1e18)
        uint256 emission = ((base * d / 1e18) * r / 1e18) * w / 1e18;

        // Circuit breaker: daily cap = 2 × E_base
        uint256 dailyCap = base * 2;
        if (emission > dailyCap) emission = dailyCap;

        // Circuit breaker: cumulative cap
        uint256 remaining = micToken.remainingMiningPool();
        if (emission > remaining) emission = remaining;

        return emission;
    }

    /// @notice Distribute daily emission to 4 pools. Callable once per day.
    function distributeDaily() external nonReentrant {
        require(block.timestamp >= lastDistribution + 1 days, "EC: too early");
        require(!priceFloorBreached, "EC: price floor breached");

        uint256 emission = dailyEmission();
        if (emission == 0) {
            lastDistribution = block.timestamp;
            return;
        }

        lastDistribution = block.timestamp;
        totalEmitted += emission;

        // Early Staking Boost: dynamic miner/staking split for first 90 days
        // Staking absorbs what miners give up (DAO and Community NFT Reward unchanged)
        uint256 currentMiners  = _currentMinerBps();
        uint256 currentStaking = stakingBps + (minersBps - currentMiners);

        // Split to 4 pools
        uint256 toMiners        = (emission * currentMiners)  / 10000;
        uint256 toStaking       = (emission * currentStaking) / 10000;
        uint256 toDAO           = (emission * daoBps)         / 10000;
        uint256 toCommunityNFT  = emission - toMiners - toStaking - toDAO;

        // Mint to each pool
        if (toMiners > 0)       micToken.mintFromMining(miningPool, toMiners);
        if (toStaking > 0)      micToken.mintFromMining(stakingPool, toStaking);
        if (toDAO > 0)          micToken.mintFromMining(daoTreasury, toDAO);
        if (toCommunityNFT > 0) micToken.mintFromMining(communityNFTPool, toCommunityNFT);

        uint256 day = (block.timestamp - deployTime) / 1 days;
        emit DailyDistributed(day, emission, toMiners, toStaking, toDAO, toCommunityNFT);
    }

    // --- Oracle updates ---

    function setROI(uint256 roiBps) external onlyRole(ORACLE_ROLE) {
        emit ROIUpdated(currentROI, roiBps);
        currentROI = roiBps;
    }

    function setPriceFloorBreached(bool breached) external onlyRole(ORACLE_ROLE) {
        priceFloorBreached = breached;
        emit PriceFloorToggled(breached);
    }

    // --- Admin ---

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

    /// @notice Adjust emission split ratios within ±10% of original values
    /// @param _miners Miners pool BPS
    /// @param _staking Staking pool BPS
    /// @param _dao DAO treasury BPS
    /// @param _communityNFT Community NFT Reward BPS
    function setSplitRatios(
        uint256 _miners,
        uint256 _staking,
        uint256 _dao,
        uint256 _communityNFT
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Must sum to 100%
        require(_miners + _staking + _dao + _communityNFT == 10000, "EC: must total 100%");

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

        minersBps        = _miners;
        stakingBps       = _staking;
        daoBps           = _dao;
        communityNFTBps  = _communityNFT;

        emit SplitRatiosUpdated(_miners, _staking, _dao, _communityNFT);
    }
}
