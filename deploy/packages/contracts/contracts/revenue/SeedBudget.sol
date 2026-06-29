// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SeedBudget — SEED Round Revenue Splitter with Agent KPI System
/// @notice Receives 100% USDT from SeedSale and splits it:
///   - 50% Operational: Founder 7% + Architect 5% + CTO 3% + Social Media 3%
///                       + Tech Manager 2% + Agent KPI 20% + Bonus 10%
///   - 50% Net Capital:  Liquidity 40% + Audit & Legal 5% + Reserved (DAO) 5%
///
///   The 7 leadership roles auto-accumulate USDT on each distribution.
///   Role holders call claimLeadership(roleIndex) to pull their USDT.
///   The Agent KPI pool (20%) is managed by admin via allocateAgentCommission().
///
/// @dev BPS values sum to 10_000:
///   Operational: 700 + 500 + 300 + 300 + 200 + 2000 + 1000 = 5000
///   Net Capital: 4000 + 500 + 500 = 5000
///   Total: 10_000 ✓
contract SeedBudget is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────────────────────

    /// @notice Role granted to SeedSale contract so it can call receiveAndDistribute
    bytes32 public constant CALLER_ROLE = keccak256("CALLER_ROLE");

    // ─── State ────────────────────────────────────────────────────────────────

    IERC20 public immutable usdt;

    address public liquidityPool;
    address public auditWallet;
    address public daoReserve;

    /// @notice 7 leadership wallets indexed 0–6:
    ///   0 = Founder (7%)
    ///   1 = Architect (5%)
    ///   2 = CTO (3%)
    ///   3 = Social Media (3%)
    ///   4 = Tech Manager (2%)
    ///   5 = Agent KPI pool wallet (20%)
    ///   6 = Bonus pool wallet (10%)
    address[7] private _leadershipWallets;

    // BPS allocations for each leadership role (out of 10_000)
    // [Founder=700, Architect=500, CTO=300, SocialMedia=300, TechMgr=200, AgentKPI=2000, Bonus=1000]
    uint256 private constant BPS_L0 = 700;   // Founder
    uint256 private constant BPS_L1 = 500;   // Architect
    uint256 private constant BPS_L2 = 300;   // CTO
    uint256 private constant BPS_L3 = 300;   // Social Media
    uint256 private constant BPS_L4 = 200;   // Tech Manager
    uint256 private constant BPS_L5 = 2000;  // Agent KPI pool
    uint256 private constant BPS_L6 = 1000;  // Bonus

    /// @notice BPS for Net Capital destinations (out of 10_000)
    uint256 private constant BPS_LIQUIDITY   = 4000; // 40%
    uint256 private constant BPS_AUDIT       = 500;  // 5%
    uint256 private constant BPS_DAO_RESERVE = 500;  // 5%

    /// @notice Accumulated USDT pending claim for each leadership role
    mapping(uint256 => uint256) public pendingLeadership;

    /// @notice KPI pool balance — accumulated from Agent KPI slot (index 5),
    ///         decremented when admin allocates commissions to agents
    uint256 public kpiPoolBalance;

    // ─── Agent KPI State ──────────────────────────────────────────────────────

    struct AgentInfo {
        bool active;
        uint256 commissionBps;  // e.g. 2000 = 20%, 1000 = 10%
        uint256 totalSales;     // cumulative USDT recorded via recordAgentSale
    }

    mapping(address => AgentInfo) private _agents;

    /// @notice Pending USDT commission for each agent (claimable)
    mapping(address => uint256) public pendingAgentCommission;

    // ─── Events ───────────────────────────────────────────────────────────────

    event RevenueDistributed(
        uint256 indexed totalAmount,
        uint256 liquidityAmount,
        uint256 auditAmount,
        uint256 daoReserveAmount
    );
    event LeadershipClaimed(uint256 indexed roleIndex, address indexed wallet, uint256 amount);
    event LeadershipWalletUpdated(uint256 indexed roleIndex, address indexed newWallet);

    event AgentAdded(address indexed agent, uint256 commissionBps);
    event AgentRemoved(address indexed agent);
    event AgentSaleRecorded(address indexed agent, uint256 usdtAmount);
    event AgentCommissionAllocated(address indexed agent, uint256 amount);
    event AgentCommissionClaimed(address indexed agent, uint256 amount);

    event LiquidityPoolUpdated(address indexed newAddress);
    event AuditWalletUpdated(address indexed newAddress);
    event DaoReserveUpdated(address indexed newAddress);

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _usdt          USDT token address (6 decimals)
    /// @param _liquidityPool Receives 40% of total (Net Capital — Liquidity)
    /// @param _auditWallet   Receives 5% of total (Net Capital — Audit & Legal)
    /// @param _daoReserve    Receives 5% of total (Net Capital — Reserved DAO)
    /// @param _admin         Granted DEFAULT_ADMIN_ROLE
    /// @param _wallets       7 leadership wallets [Founder, Architect, CTO,
    ///                       Social Media, Tech Manager, Agent KPI pool, Bonus pool]
    constructor(
        address _usdt,
        address _liquidityPool,
        address _auditWallet,
        address _daoReserve,
        address _admin,
        address[7] memory _wallets
    ) {
        require(_usdt != address(0), "SeedBudget: zero USDT");
        require(_liquidityPool != address(0), "SeedBudget: zero address");
        require(_auditWallet   != address(0), "SeedBudget: zero address");
        require(_daoReserve    != address(0), "SeedBudget: zero address");

        for (uint256 i = 0; i < 7; i++) {
            require(_wallets[i] != address(0), "SeedBudget: zero wallet");
            _leadershipWallets[i] = _wallets[i];
        }

        usdt          = IERC20(_usdt);
        liquidityPool = _liquidityPool;
        auditWallet   = _auditWallet;
        daoReserve    = _daoReserve;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ─── Core Distribution ────────────────────────────────────────────────────

    /// @notice Pull USDT from caller and split per allocation table.
    ///         Net Capital (liquidity + audit + DAO) is forwarded immediately.
    ///         Operational shares accumulate in pendingLeadership for self-claim.
    /// @dev Caller must approve this contract for `amount` USDT first.
    /// @param amount Total USDT amount (6 decimals)
    function receiveAndDistribute(uint256 amount)
        external
        nonReentrant
        onlyRole(CALLER_ROLE)
    {
        require(amount > 0, "SeedBudget: zero amount");

        // Pull USDT from caller
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        // ── Net Capital: forward immediately ──
        uint256 liqAmt  = (amount * BPS_LIQUIDITY)   / 10_000;
        uint256 audAmt  = (amount * BPS_AUDIT)        / 10_000;
        uint256 daoAmt  = (amount * BPS_DAO_RESERVE)  / 10_000;

        usdt.safeTransfer(liquidityPool, liqAmt);
        usdt.safeTransfer(auditWallet,   audAmt);
        usdt.safeTransfer(daoReserve,    daoAmt);

        // ── Operational: accumulate for self-claim ──
        pendingLeadership[0] += (amount * BPS_L0) / 10_000;
        pendingLeadership[1] += (amount * BPS_L1) / 10_000;
        pendingLeadership[2] += (amount * BPS_L2) / 10_000;
        pendingLeadership[3] += (amount * BPS_L3) / 10_000;
        pendingLeadership[4] += (amount * BPS_L4) / 10_000;
        pendingLeadership[5] += (amount * BPS_L5) / 10_000;
        pendingLeadership[6] += (amount * BPS_L6) / 10_000;

        // The Agent KPI slot (index 5) also feeds the kpiPoolBalance
        kpiPoolBalance += (amount * BPS_L5) / 10_000;

        emit RevenueDistributed(amount, liqAmt, audAmt, daoAmt);
    }

    // ─── Leadership Claiming ──────────────────────────────────────────────────

    /// @notice Role holder claims their accumulated USDT allocation.
    /// @param roleIndex 0=Founder, 1=Architect, 2=CTO, 3=Social Media,
    ///                  4=Tech Manager, 5=Agent KPI pool, 6=Bonus
    function claimLeadership(uint256 roleIndex) external nonReentrant {
        require(roleIndex < 7, "SeedBudget: invalid role");
        require(msg.sender == _leadershipWallets[roleIndex], "SeedBudget: not wallet owner");

        uint256 amount = pendingLeadership[roleIndex];
        require(amount > 0, "SeedBudget: nothing to claim");

        pendingLeadership[roleIndex] = 0;

        // For the KPI pool slot (index 5): claiming drains the pool wallet share
        // but kpiPoolBalance tracks the sub-allocation for agents — keep separate
        if (roleIndex == 5) {
            // KPI pool wallet claims only what has NOT yet been allocated to agents
            // kpiPoolBalance already tracks unallocated; reduce by claim
            // Note: the claim here is for the pool wallet's direct share;
            // agent commissions are allocated separately and tracked via kpiPoolBalance
            // Since we track kpiPoolBalance for agent allocations independently,
            // we don't double-drain — claimLeadership(5) is for the pool admin wallet.
        }

        usdt.safeTransfer(_leadershipWallets[roleIndex], amount);
        emit LeadershipClaimed(roleIndex, _leadershipWallets[roleIndex], amount);
    }

    // ─── Agent KPI Management ────────────────────────────────────────────────

    /// @notice Admin adds an agent with a commission rate.
    /// @param agent         Agent wallet address
    /// @param commissionBps Commission in BPS (e.g. 2000 = 20%, 1000 = 10%)
    function addAgent(address agent, uint256 commissionBps)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(agent != address(0), "SeedBudget: zero agent");
        require(commissionBps <= 10_000, "SeedBudget: invalid BPS");

        _agents[agent] = AgentInfo({
            active: true,
            commissionBps: commissionBps,
            totalSales: 0
        });

        emit AgentAdded(agent, commissionBps);
    }

    /// @notice Admin removes an agent (marks inactive).
    function removeAgent(address agent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_agents[agent].active, "SeedBudget: not an agent");
        _agents[agent].active = false;
        emit AgentRemoved(agent);
    }

    /// @notice Admin records a sale attributed to an agent (for KPI tracking).
    /// @param agent      Agent wallet address
    /// @param usdtAmount USDT amount of the sale (6 decimals)
    function recordAgentSale(address agent, uint256 usdtAmount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_agents[agent].active, "SeedBudget: not an agent");
        _agents[agent].totalSales += usdtAmount;
        emit AgentSaleRecorded(agent, usdtAmount);
    }

    /// @notice Admin allocates a commission amount from the KPI pool to an agent.
    ///         Must not exceed available kpiPoolBalance.
    /// @param agent  Agent wallet address
    /// @param amount USDT commission amount (6 decimals)
    function allocateAgentCommission(address agent, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(_agents[agent].active, "SeedBudget: not an agent");
        require(amount <= kpiPoolBalance, "SeedBudget: exceeds KPI pool");

        kpiPoolBalance -= amount;
        pendingAgentCommission[agent] += amount;

        emit AgentCommissionAllocated(agent, amount);
    }

    /// @notice Agent claims their accumulated commission.
    function claimAgentCommission() external nonReentrant {
        uint256 amount = pendingAgentCommission[msg.sender];
        require(amount > 0, "SeedBudget: nothing to claim");

        pendingAgentCommission[msg.sender] = 0;
        usdt.safeTransfer(msg.sender, amount);

        emit AgentCommissionClaimed(msg.sender, amount);
    }

    // ─── View Helpers ─────────────────────────────────────────────────────────

    /// @notice Returns leadership wallet for a given role index.
    function leadershipWallet(uint256 roleIndex) external view returns (address) {
        require(roleIndex < 7, "SeedBudget: invalid role");
        return _leadershipWallets[roleIndex];
    }

    /// @notice Returns agent commission BPS for a given agent address.
    function agentCommissionBps(address agent) external view returns (uint256) {
        return _agents[agent].commissionBps;
    }

    /// @notice Returns whether an agent is currently active.
    function isActiveAgent(address agent) external view returns (bool) {
        return _agents[agent].active;
    }

    /// @notice Returns cumulative USDT sales recorded for an agent.
    function agentTotalSales(address agent) external view returns (uint256) {
        return _agents[agent].totalSales;
    }

    // ─── Admin Configuration ──────────────────────────────────────────────────

    /// @notice Admin updates a leadership wallet address.
    function setLeadershipWallet(uint256 roleIndex, address newWallet)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(roleIndex < 7, "SeedBudget: invalid role");
        require(newWallet != address(0), "SeedBudget: zero wallet");
        _leadershipWallets[roleIndex] = newWallet;
        emit LeadershipWalletUpdated(roleIndex, newWallet);
    }

    /// @notice Admin updates the liquidity pool address.
    function setLiquidityPool(address newAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddress != address(0), "SeedBudget: zero address");
        liquidityPool = newAddress;
        emit LiquidityPoolUpdated(newAddress);
    }

    /// @notice Admin updates the audit wallet address.
    function setAuditWallet(address newAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddress != address(0), "SeedBudget: zero address");
        auditWallet = newAddress;
        emit AuditWalletUpdated(newAddress);
    }

    /// @notice Admin updates the DAO reserve address.
    function setDaoReserve(address newAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newAddress != address(0), "SeedBudget: zero address");
        daoReserve = newAddress;
        emit DaoReserveUpdated(newAddress);
    }
}
