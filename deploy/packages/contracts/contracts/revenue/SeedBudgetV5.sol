// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Generic interface for downstream pools that receive USDT.
interface IPoolReceiver {
    function receiveAndDistribute(uint256 amount) external;
}

/// @title SeedBudget v5 — SEED revenue splitter (Phase 2c redesign)
/// @notice Receives 100% USDT from SeedSale and routes to 5 destinations:
///   - 20% Distribution Program  → distributionProgramPool
///   - 20% Operational Activities → operationalSalaryPool (Steward Council)
///   - 10% Management Bonus       → managementBonusPool (Council vote 75%)
///   - 40% Initial Liquidity      → liquidityPool (closed-loop)
///   - 10% Reserved Expenses      → reservedExpensesPool (DAO)
///
/// @dev Replaces v4 SeedBudget which had Audit 5% slot (now removed).
///      All targets are pool contracts implementing IPoolReceiver — caller
///      pre-approves USDT and they pull. No funds leak to EOAs.
///
///      Owner can update target addresses (DEFAULT_ADMIN_ROLE).
///      Mainnet should transfer DEFAULT_ADMIN_ROLE to DAOGovernor with
///      timelock to prevent unilateral retargeting.
contract SeedBudgetV5 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Granted to SeedSale — calls receiveAndDistribute on each purchase
    bytes32 public constant CALLER_ROLE = keccak256("CALLER_ROLE");

    IERC20 public immutable usdt;

    address public distributionProgramPool;
    address public operationalSalaryPool;
    address public managementBonusPool;
    address public liquidityPool;
    address public reservedExpensesPool;

    // BPS allocation (sum = 10_000)
    uint256 public constant BPS_DISTRIBUTION = 2000; // 20%
    uint256 public constant BPS_OPERATIONAL  = 2000; // 20%
    uint256 public constant BPS_MGMT_BONUS   = 1000; // 10%
    uint256 public constant BPS_LIQUIDITY    = 4000; // 40%
    uint256 public constant BPS_RESERVED     = 1000; // 10%

    event RevenueDistributed(
        uint256 indexed totalAmount,
        uint256 distribution,
        uint256 operational,
        uint256 mgmtBonus,
        uint256 liquidity,
        uint256 reserved
    );
    event TargetUpdated(string indexed slot, address indexed newAddress);

    constructor(
        address _usdt,
        address _distributionProgramPool,
        address _operationalSalaryPool,
        address _managementBonusPool,
        address _liquidityPool,
        address _reservedExpensesPool,
        address _admin
    ) {
        require(_usdt != address(0), "SBv5: zero usdt");
        require(_admin != address(0), "SBv5: zero admin");

        usdt                    = IERC20(_usdt);
        distributionProgramPool = _distributionProgramPool;
        operationalSalaryPool   = _operationalSalaryPool;
        managementBonusPool     = _managementBonusPool;
        liquidityPool           = _liquidityPool;
        reservedExpensesPool    = _reservedExpensesPool;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    /// @notice Pull USDT from caller, split into 5 pools.
    ///         Each pool's `receiveAndDistribute(amount)` is called after approval.
    ///         If a target is unset (address(0)), that slice stays in this contract
    ///         until the target is configured (then sweepable via sweepSlice).
    function receiveAndDistribute(uint256 amount)
        external
        nonReentrant
        onlyRole(CALLER_ROLE)
    {
        require(amount > 0, "SBv5: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        uint256 dist = (amount * BPS_DISTRIBUTION) / 10_000;
        uint256 oper = (amount * BPS_OPERATIONAL)  / 10_000;
        uint256 mgmt = (amount * BPS_MGMT_BONUS)   / 10_000;
        uint256 liq  = (amount * BPS_LIQUIDITY)    / 10_000;
        uint256 res  = (amount * BPS_RESERVED)     / 10_000;

        _forward(distributionProgramPool, dist);
        _forward(operationalSalaryPool,   oper);
        _forward(managementBonusPool,     mgmt);
        _forward(liquidityPool,           liq);
        _forward(reservedExpensesPool,    res);

        emit RevenueDistributed(amount, dist, oper, mgmt, liq, res);
    }

    function _forward(address target, uint256 amount) internal {
        if (target == address(0) || amount == 0) return;
        // Approve target then call receiveAndDistribute (target pulls).
        usdt.forceApprove(target, amount);
        IPoolReceiver(target).receiveAndDistribute(amount);
    }

    // ─── Admin: target retargeting ───────────────────────────────────────

    function setDistributionProgramPool(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        distributionProgramPool = a;
        emit TargetUpdated("distributionProgramPool", a);
    }
    function setOperationalSalaryPool(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        operationalSalaryPool = a;
        emit TargetUpdated("operationalSalaryPool", a);
    }
    function setManagementBonusPool(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        managementBonusPool = a;
        emit TargetUpdated("managementBonusPool", a);
    }
    function setLiquidityPool(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        liquidityPool = a;
        emit TargetUpdated("liquidityPool", a);
    }
    function setReservedExpensesPool(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        reservedExpensesPool = a;
        emit TargetUpdated("reservedExpensesPool", a);
    }

    // ─── Admin: sweep stuck slice ────────────────────────────────────────
    // If a pool target was unset during a distribution, the unforwarded amount
    // stays in this contract. After target is configured, admin can sweep
    // those leftover balances to the correct pool.

    /// @notice Sweep all USDT balance to the specified pool (one-shot recovery).
    /// @dev Admin-only. Use after fixing a target address.
    function sweepBalanceToPool(address pool) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        require(pool != address(0), "SBv5: zero pool");
        uint256 bal = usdt.balanceOf(address(this));
        require(bal > 0, "SBv5: zero balance");
        usdt.forceApprove(pool, bal);
        IPoolReceiver(pool).receiveAndDistribute(bal);
    }

    function balance() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }
}
