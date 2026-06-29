// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ReservedExpensesPool — 10% of SEED revenue, DAO-decided
/// @notice
///   - Receives USDT from SeedBudget via receiveAndDistribute().
///   - Withdrawals follow 2-step pattern: requestWithdraw → 7-day cooldown → executeWithdraw.
///   - Owner can cancel any pending request before execution.
///   - Phase 1: Owner controls. Mainnet: transfer ownership to DAOGovernor with timelock.
contract ReservedExpensesPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable owner;
    address public distributor; // SeedBudget contract

    IERC20 public immutable usdt;

    uint256 public constant COOLDOWN = 7 days;

    enum RequestStatus { PENDING, EXECUTED, CANCELLED }

    struct WithdrawRequest {
        uint256 id;
        address recipient;
        uint256 amount;
        string  reason;
        address requester;
        uint64  createdAt;
        uint64  cooldownEnd;
        RequestStatus status;
        uint64  executedAt;
    }

    mapping(uint256 => WithdrawRequest) public requests;
    uint256 public nextRequestId;

    uint256 public totalReceived;
    uint256 public totalExecuted;

    event Received(uint256 amount, uint256 totalReceived);
    event WithdrawRequested(uint256 indexed id, address indexed recipient, uint256 amount, uint64 cooldownEnd, string reason);
    event WithdrawExecuted(uint256 indexed id, address indexed recipient, uint256 amount);
    event WithdrawCancelled(uint256 indexed id, address indexed by);
    event DistributorSet(address distributor);

    modifier onlyOwner() {
        require(msg.sender == owner, "REP: not owner");
        _;
    }
    modifier onlyDistributor() {
        require(msg.sender == distributor, "REP: not distributor");
        _;
    }

    constructor(address _usdt, address _owner) {
        require(_usdt != address(0), "REP: zero usdt");
        require(_owner != address(0), "REP: zero owner");
        usdt  = IERC20(_usdt);
        owner = _owner;
    }

    function setDistributor(address _distributor) external onlyOwner {
        distributor = _distributor;
        emit DistributorSet(_distributor);
    }

    function receiveAndDistribute(uint256 amount) external onlyDistributor nonReentrant {
        require(amount > 0, "REP: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        totalReceived += amount;
        emit Received(amount, totalReceived);
    }

    /// @notice Owner creates a withdrawal request — 7-day cooldown before execute.
    function requestWithdraw(address recipient, uint256 amount, string calldata reason)
        external
        onlyOwner
        returns (uint256 id)
    {
        require(recipient != address(0), "REP: zero recipient");
        require(amount > 0, "REP: zero amount");
        require(amount <= usdt.balanceOf(address(this)), "REP: insufficient balance");

        id = ++nextRequestId;
        uint64 cooldownEnd = uint64(block.timestamp + COOLDOWN);
        requests[id] = WithdrawRequest({
            id:          id,
            recipient:   recipient,
            amount:      amount,
            reason:      reason,
            requester:   msg.sender,
            createdAt:   uint64(block.timestamp),
            cooldownEnd: cooldownEnd,
            status:      RequestStatus.PENDING,
            executedAt:  0
        });
        emit WithdrawRequested(id, recipient, amount, cooldownEnd, reason);
    }

    /// @notice Anyone can call after cooldown — pulls USDT from pool to recipient.
    function executeWithdraw(uint256 id) external nonReentrant {
        WithdrawRequest storage r = requests[id];
        require(r.id == id && id != 0, "REP: invalid id");
        require(r.status == RequestStatus.PENDING, "REP: not pending");
        require(block.timestamp >= r.cooldownEnd, "REP: cooldown active");
        require(r.amount <= usdt.balanceOf(address(this)), "REP: insufficient balance");

        r.status     = RequestStatus.EXECUTED;
        r.executedAt = uint64(block.timestamp);
        totalExecuted += r.amount;

        usdt.safeTransfer(r.recipient, r.amount);
        emit WithdrawExecuted(id, r.recipient, r.amount);
    }

    /// @notice Owner cancels any pending request.
    function cancelWithdraw(uint256 id) external onlyOwner {
        WithdrawRequest storage r = requests[id];
        require(r.id == id && id != 0, "REP: invalid id");
        require(r.status == RequestStatus.PENDING, "REP: not pending");
        r.status = RequestStatus.CANCELLED;
        emit WithdrawCancelled(id, msg.sender);
    }

    function poolBalance() external view returns (uint256) { return usdt.balanceOf(address(this)); }
    function getRequest(uint256 id) external view returns (WithdrawRequest memory) { return requests[id]; }
}
