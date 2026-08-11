// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILockManagerV2 {
    function createSchedule(
        address beneficiary,
        uint256 amount,
        uint256 cliffDuration,
        uint256 cliffUnlockBps,
        uint256 monthlyUnlockBps
    ) external;
}

/// @title TreasuryManagerV2 — DAO treasury for BOTH USDT and MIC
/// @notice
/// Replaces `TreasuryManager` (`0x1ed5C848…a42F`), which declared only USDT. That
/// contract received 105,000,000 MIC at genesis and has no function capable of moving
/// it: no MIC reference, no approve, no rescue, and it is not a proxy. Those tokens are
/// unrecoverable. This contract exists so that never happens again.
///
/// **The invariant that was missing:** a contract that can *hold* a token must be able
/// to *send* that token. Every balance here has a named exit, and `rescueToken` catches
/// anything that arrives unplanned.
///
/// USDT keeps V1's governance limits — 5% of a sub-pool per transfer, twice per 30 days.
///
/// MIC arriving from EmissionController is split on arrival: 10% is forwarded to
/// `ChurchesVault`, which grants it out under a 24-month vesting schedule, and the
/// remaining 90% stays here as the DAO's operating budget, spendable only by DAO_ROLE —
/// DAOGovernor in production. The Churches share is moved, not merely book-kept, so the
/// community programme's balance is independently readable on-chain.
///
/// @dev Deploy with `admin` = DAOGovernor or the Gnosis Safe. Never an EOA in production.
contract TreasuryManagerV2 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ───────────────────────────────────────────────────────────
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 public constant DAO_ROLE         = keccak256("DAO_ROLE");

    // ─── USDT governance constraints (unchanged from V1) ─────────────────
    uint256 public constant MAX_TRANSFER_BPS         = 500;      // 5% of a sub-pool
    uint256 public constant MAX_TRANSFERS_PER_PERIOD = 2;
    uint256 public constant PERIOD_DURATION          = 30 days;

    // ─── USDT sub-pools ──────────────────────────────────────────────────
    uint256 public constant POOL_WORLD_DEV  = 0;
    uint256 public constant POOL_APP_ADDONS = 1;
    uint256 public constant POOL_RESERVED   = 2;

    uint256 private constant BPS_WORLD_DEV  = 2000;   // 2.5 of 12.5
    uint256 private constant BPS_APP_ADDONS = 4000;   // 5.0 of 12.5
    uint256 private constant BPS_RESERVED   = 4000;   // 5.0 of 12.5

    // ─── MIC vesting — the published Churches / Community schedule ───────
    /// 24-month cliff, 10% at cliff, then 2.5% monthly (~60 months in total).
    uint256 public constant MIC_CLIFF_DURATION   = 730 days;
    uint256 public constant MIC_CLIFF_UNLOCK_BPS = 1000;
    uint256 public constant MIC_MONTHLY_BPS      = 250;

    /// @notice Share of every inbound MIC forwarded to the Churches vault.
    ///         Owner decision 2026-08-06: 10% of the DAO's own 10% mining slice, i.e.
    ///         1% of daily issuance. The published 59/25/10/5/1 split is unchanged —
    ///         this is an allocation *inside* the DAO's share, not a sixth slice.
    uint256 public constant CHURCHES_SHARE_BPS = 1000;

    // ─── Tokens ──────────────────────────────────────────────────────────
    IERC20 public immutable usdt;
    IERC20 public immutable mic;
    ILockManagerV2 public lockManager;

    /// @notice Where the Churches share is sent. Its own contract rather than a ledger
    ///         here, so the community programme's balance is readable on-chain by
    ///         anyone without trusting an internal accounting variable.
    address public churchesVault;

    // ─── State ───────────────────────────────────────────────────────────
    uint256[3] public subPoolBalance;
    uint256 public totalUsdtReceived;
    mapping(uint256 => mapping(uint256 => uint256)) public periodTransferCount;

    /// @notice MIC the DAO may spend. Tracked separately from `balanceOf` so nothing is
    ///         spendable until it has been classified — the gap between the two is
    ///         exactly what V1 lost sight of.
    uint256 public micDaoAllocated;
    uint256 public micDaoDistributed;

    /// @notice Cumulative MIC forwarded to the Churches vault.
    uint256 public micToChurches;

    /// @notice Churches share that arrived before `churchesVault` was set. Held, never
    ///         mixed into the DAO ledger, and swept the moment a vault exists.
    uint256 public churchesPending;

    // ─── Events ──────────────────────────────────────────────────────────
    event USDTReceived(uint256 amount, uint256 worldDev, uint256 appAddOns, uint256 reserved);
    event UsdtTransferred(uint256 indexed subPool, address indexed to, uint256 amount);
    event EmergencyWithdraw(uint256 indexed subPool, address indexed to, uint256 amount);
    event MicBooked(uint256 amount, uint256 toChurches, uint256 toDao);
    event ChurchesFunded(address indexed vault, uint256 amount);
    event DaoMicTransferred(address indexed to, uint256 amount, string purpose);
    event ChurchesVaultSet(address indexed oldVault, address indexed newVault);
    event LockManagerSet(address indexed oldManager, address indexed newManager);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    // ─── Constructor ─────────────────────────────────────────────────────
    constructor(address _usdt, address _mic, address _lockManager, address admin) {
        require(_usdt != address(0), "TMv2: zero usdt");
        require(_mic  != address(0), "TMv2: zero mic");
        require(admin != address(0), "TMv2: zero admin");
        usdt = IERC20(_usdt);
        mic  = IERC20(_mic);
        lockManager = ILockManagerV2(_lockManager);   // may be zero; set before MIC use
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        // DAO_ROLE is deliberately NOT granted here. It bypasses the 5%-per-transfer and
        // two-per-month limits, so handing it to the same key those limits constrain
        // would make them decorative. Grant it separately, to a separate holder.
    }

    // ═════════════════════════ USDT ═════════════════════════

    /// @notice RevenueRouter pushes the treasury slice in. Split across the three
    ///         sub-pools on arrival so the books never depend on off-chain bookkeeping.
    function receiveUSDT(uint256 amount) external onlyRole(DISTRIBUTOR_ROLE) nonReentrant {
        require(amount > 0, "TMv2: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        uint256 worldDev  = (amount * BPS_WORLD_DEV)  / 10000;
        uint256 appAddOns = (amount * BPS_APP_ADDONS) / 10000;
        // Reserved absorbs the rounding dust so the three parts always sum to `amount`.
        uint256 reserved  = amount - worldDev - appAddOns;

        subPoolBalance[POOL_WORLD_DEV]  += worldDev;
        subPoolBalance[POOL_APP_ADDONS] += appAddOns;
        subPoolBalance[POOL_RESERVED]   += reserved;
        totalUsdtReceived += amount;

        emit USDTReceived(amount, worldDev, appAddOns, reserved);
    }

    /// @notice Spend from a sub-pool. Rate-limited so a single compromised key cannot
    ///         drain the treasury in one transaction or one month.
    function transferUsdt(uint256 subPool, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant
    {
        require(subPool <= POOL_RESERVED, "TMv2: invalid pool");
        require(to != address(0),          "TMv2: zero recipient");
        require(amount > 0,                "TMv2: zero amount");

        uint256 balance = subPoolBalance[subPool];
        require(balance > 0, "TMv2: pool empty");
        require(amount <= (balance * MAX_TRANSFER_BPS) / 10000, "TMv2: exceeds 5% limit");

        uint256 period = block.timestamp / PERIOD_DURATION;
        require(periodTransferCount[subPool][period] < MAX_TRANSFERS_PER_PERIOD, "TMv2: monthly limit reached");
        periodTransferCount[subPool][period] += 1;

        subPoolBalance[subPool] = balance - amount;
        usdt.safeTransfer(to, amount);
        emit UsdtTransferred(subPool, to, amount);
    }

    /// @notice DAO-only escape from the rate limit, for incidents rather than spending.
    function emergencyWithdrawUsdt(uint256 subPool, address to, uint256 amount)
        external onlyRole(DAO_ROLE) nonReentrant
    {
        require(subPool <= POOL_RESERVED, "TMv2: invalid pool");
        require(to != address(0),          "TMv2: zero recipient");
        require(amount > 0,                "TMv2: zero amount");
        require(subPoolBalance[subPool] >= amount, "TMv2: insufficient balance");

        subPoolBalance[subPool] -= amount;
        usdt.safeTransfer(to, amount);
        emit EmergencyWithdraw(subPool, to, amount);
    }

    // ═════════════════════════ MIC ═════════════════════════

    /// @notice Classify MIC that has arrived, forward the Churches share, keep the rest
    ///         for the DAO.
    /// @dev EmissionController delivers the DAO slice with `mintFromMining(daoTreasury,…)`
    ///      — a direct mint with no callback — so there is nothing to "receive". This
    ///      books whatever has landed since the last call. Permissionless on purpose: it
    ///      moves value only along a fixed route to a fixed address, and gating it would
    ///      mean the earmark silently stops the first time someone forgets.
    function syncMic() public returns (uint256 booked) {
        booked = micUnbooked();
        if (booked > 0) {
            uint256 toChurches = (booked * CHURCHES_SHARE_BPS) / 10000;
            // The DAO takes the remainder so rounding dust never strands unclassified.
            uint256 toDao = booked - toChurches;

            micDaoAllocated += toDao;
            churchesPending += toChurches;
            emit MicBooked(booked, toChurches, toDao);
        }
        _sweepChurches();
    }

    /// @dev Push whatever the Churches programme is owed into its vault. Split out so a
    ///      vault set after emission has already started still collects the backlog.
    function _sweepChurches() internal {
        uint256 owed = churchesPending;
        if (owed == 0 || churchesVault == address(0)) return;
        churchesPending = 0;
        micToChurches += owed;
        mic.safeTransfer(churchesVault, owed);
        emit ChurchesFunded(churchesVault, owed);
    }

    /// @notice Deliberately fund the treasury by pushing MIC in. Same split applies.
    function receiveMIC(uint256 amount) external nonReentrant {
        require(amount > 0, "TMv2: zero amount");
        mic.safeTransferFrom(msg.sender, address(this), amount);
        syncMic();
    }

    /// @notice Spend the DAO's share. Governance decides the release, so this carries no
    ///         vesting curve — unlike a Churches grant, which vests at the recipient.
    function transferDaoMIC(address to, uint256 amount, string calldata purpose)
        external onlyRole(DAO_ROLE) nonReentrant
    {
        require(to != address(0), "TMv2: zero recipient");
        require(amount > 0,       "TMv2: zero amount");
        syncMic();
        require(micDaoDistributed + amount <= micDaoAllocated, "TMv2: exceeds DAO ledger");

        micDaoDistributed += amount;
        mic.safeTransfer(to, amount);
        emit DaoMicTransferred(to, amount, purpose);
    }

    function setChurchesVault(address _vault) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_vault != address(0), "TMv2: zero vault");
        emit ChurchesVaultSet(churchesVault, _vault);
        churchesVault = _vault;
        _sweepChurches();   // pay any backlog straight away
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function micDaoRemaining() public view returns (uint256) {
        return micDaoAllocated - micDaoDistributed;
    }

    /// @notice MIC held here that has not been classified yet — normally the emission
    ///         that has arrived since the last `syncMic()`.
    function micUnbooked() public view returns (uint256) {
        uint256 held = mic.balanceOf(address(this));
        uint256 booked = micDaoRemaining() + churchesPending;
        return held > booked ? held - booked : 0;
    }

    function setLockManager(address _lockManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_lockManager != address(0), "TMv2: zero lockManager");
        emit LockManagerSet(address(lockManager), _lockManager);
        lockManager = ILockManagerV2(_lockManager);
    }

    // ═════════════════════ Rescue ═════════════════════

    /// @notice Recover any token that arrives here unplanned — the failure mode that
    ///         immobilised 105,000,000 MIC in V1. Accounted balances are protected: this
    ///         can never touch USDT backing the sub-pools, nor MIC booked for
    ///         distribution. It only reaches the surplus.
    function rescueToken(address token, address to, uint256 amount)
        external onlyRole(DAO_ROLE) nonReentrant
    {
        require(to != address(0), "TMv2: zero recipient");
        require(amount > 0,       "TMv2: zero amount");

        uint256 held = IERC20(token).balanceOf(address(this));
        uint256 reserved_;
        if (token == address(usdt)) {
            reserved_ = subPoolBalance[0] + subPoolBalance[1] + subPoolBalance[2];
        } else if (token == address(mic)) {
            // Book first: emission that has arrived but not been classified is treasury
            // money, not a stray deposit, and must not be reachable here.
            syncMic();
            held = mic.balanceOf(address(this));
            reserved_ = micDaoRemaining() + churchesPending;
        }
        require(held - reserved_ >= amount, "TMv2: would touch accounted balance");

        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }
}
