// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISeedBudgetV5b {
    function release(uint8 slot, address recipient, uint256 amount) external;
    function slotBalance(uint8 slot) external view returns (uint256);
}

/// @title ReservedExpensesPoolV2 — Policy contract for SEED Reserved slot (10%)
/// @notice
///   Does NOT hold USDT. Owner creates withdrawal requests; after 7-day
///   cooldown anyone can execute → calls SeedBudgetV5b.release(SLOT_RESERVED, ...).
///   Owner can cancel any pending request before execution.
contract ReservedExpensesPoolV2 is ReentrancyGuard {
    address public immutable owner;
    ISeedBudgetV5b public immutable seedBudget;

    uint8 public constant SLOT_RESERVED = 4;
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

    event WithdrawRequested(uint256 indexed id, address indexed recipient, uint256 amount, uint64 cooldownEnd, string reason);
    event WithdrawExecuted(uint256 indexed id, address indexed recipient, uint256 amount);
    event WithdrawCancelled(uint256 indexed id, address indexed by);

    modifier onlyOwner() { require(msg.sender == owner, "REPv2: not owner"); _; }

    constructor(address _seedBudget, address _owner) {
        require(_seedBudget != address(0), "REPv2: zero seedBudget");
        require(_owner != address(0), "REPv2: zero owner");
        seedBudget = ISeedBudgetV5b(_seedBudget);
        owner = _owner;
    }

    function requestWithdraw(address recipient, uint256 amount, string calldata reason)
        external
        onlyOwner
        returns (uint256 id)
    {
        require(recipient != address(0), "REPv2: zero recipient");
        require(amount > 0, "REPv2: zero amount");

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

    function executeWithdraw(uint256 id) external nonReentrant {
        WithdrawRequest storage r = requests[id];
        require(r.id == id && id != 0, "REPv2: invalid id");
        require(r.status == RequestStatus.PENDING, "REPv2: not pending");
        require(block.timestamp >= r.cooldownEnd, "REPv2: cooldown active");
        require(seedBudget.slotBalance(SLOT_RESERVED) >= r.amount, "REPv2: insufficient slot balance");

        r.status     = RequestStatus.EXECUTED;
        r.executedAt = uint64(block.timestamp);

        seedBudget.release(SLOT_RESERVED, r.recipient, r.amount);
        emit WithdrawExecuted(id, r.recipient, r.amount);
    }

    function cancelWithdraw(uint256 id) external onlyOwner {
        WithdrawRequest storage r = requests[id];
        require(r.id == id && id != 0, "REPv2: invalid id");
        require(r.status == RequestStatus.PENDING, "REPv2: not pending");
        r.status = RequestStatus.CANCELLED;
        emit WithdrawCancelled(id, msg.sender);
    }

    function getRequest(uint256 id) external view returns (WithdrawRequest memory) { return requests[id]; }
}
