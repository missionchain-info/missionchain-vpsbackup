// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ListingReserve — Listing & External Market Fund (DAO-governed, timelocked)
/// @notice Receives the 5% USDT slice from RevenueRouter and HOLDS it until the protocol
///         is ready to open an external market for MIC. Withdrawals use a
///         request → 24h → execute timelock, so no single transaction can drain it.
///
///         Purpose: the protocol liquidity pool is closed-loop — USDT that enters it can
///         never leave. Seeding an external exchange pair therefore needs funding from
///         somewhere else, and this is that funding. External demand is the strongest
///         lever in the model: it is the only way a holder can exit without the pool
///         paying, which is what lifts returns for everyone still in.
///
///         This fund does NOT buy MIC to support the price. There is no price trigger,
///         no moving-average condition, and no automated market operation of any kind.
///         The protocol controls issuance, not price. Deployment of this fund is a
///         one-time, DAO-approved act of opening a market, not an intervention in one.
///
/// @dev    Governance: admin is DAOGovernor. Renamed from StakingReserve 2026-08-05 —
///         the original "buy MIC when price dips below the 30-day average" design was a
///         price-support mechanism and was removed. Long-term staking support, if ever
///         needed, comes from the DAO Treasury quarterly allocation instead.
contract ListingReserve is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Granted to RevenueRouter — may call receiveUSDT().
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    /// @notice Withdrawal delay. Admin is DAOGovernor: a withdrawal needs a governance
    ///         decision AND then a 24-hour wait before it can execute.
    uint256 public constant TIMELOCK = 24 hours;

    IERC20  public immutable usdt;
    uint256 public totalReceived;

    struct Pending { address to; uint256 amount; uint64 unlockTime; bool active; }
    /// @notice The single in-flight withdrawal request (one at a time).
    Pending public pending;

    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    event USDTReceived(uint256 amount, uint256 totalReceived);
    event WithdrawRequested(address indexed to, uint256 amount, uint256 unlockTime);
    event WithdrawExecuted(address indexed to, uint256 amount);
    event WithdrawCancelled(address indexed to, uint256 amount);

    constructor(address _usdt, address _admin) {
        require(_usdt != address(0) && _admin != address(0), "ListingReserve: zero addr");
        usdt = IERC20(_usdt);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    /// @notice Fund the reserve (pull). Called by RevenueRouter.
    function receiveUSDT(uint256 amount) external nonReentrant onlyRole(DISTRIBUTOR_ROLE) {
        require(amount > 0, "ListingReserve: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        totalReceived += amount;
        emit USDTReceived(amount, totalReceived);
    }

    /// @notice Step 1 — admin requests a withdrawal (starts the timelock). Replaces any
    ///         existing pending request.
    function requestWithdraw(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0), "ListingReserve: zero to");
        require(amount > 0 && amount <= balance(), "ListingReserve: bad amount");
        pending = Pending({ to: to, amount: amount, unlockTime: uint64(block.timestamp + TIMELOCK), active: true });
        emit WithdrawRequested(to, amount, block.timestamp + TIMELOCK);
    }

    /// @notice Step 2 — admin executes the withdrawal after the timelock elapses.
    function executeWithdraw() external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        Pending memory p = pending;
        require(p.active, "ListingReserve: no pending");
        require(block.timestamp >= p.unlockTime, "ListingReserve: timelock active");
        require(p.amount <= balance(), "ListingReserve: insufficient");
        delete pending;
        usdt.safeTransfer(p.to, p.amount);
        emit WithdrawExecuted(p.to, p.amount);
    }

    /// @notice Cancel the pending withdrawal request.
    function cancelWithdraw() external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(pending.active, "ListingReserve: no pending");
        emit WithdrawCancelled(pending.to, pending.amount);
        delete pending;
    }

    /// @notice Current USDT held by the reserve.
    function balance() public view returns (uint256) {
        return usdt.balanceOf(address(this));
    }

    /// @notice Recover ERC-20 tokens sent here by mistake.
    /// @dev A contract that can hold a token must be able to send it. `TreasuryManager`
    ///      v1 could not, and 105,000,000 MIC is stranded there permanently as a result.
    ///      These contracts are not upgradeable, so this cannot be added later.
    ///      USDT is excluded: it already has a governed exit through requestWithdraw /
    ///      executeWithdraw with its cooldown. Routing it through a rescue would bypass that.
    function rescueToken(address token, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant
    {
        require(to != address(0), "LIS: zero recipient");
        require(amount > 0,       "LIS: zero amount");
        require(token != address(usdt), "LIS: usdt has its own path");
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }
}
