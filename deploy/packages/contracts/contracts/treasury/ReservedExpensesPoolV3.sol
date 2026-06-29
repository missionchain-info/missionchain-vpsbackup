// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IStewardCouncil {
    function isMember(address) external view returns (bool);
    function activeCount() external view returns (uint256);
}

interface ISeedBudgetV5c {
    function release(uint8 slot, address recipient, uint256 amount) external;
    function slotBalance(uint8) external view returns (uint256);
}

/// @title ReservedExpensesPoolV3 — Council voting controller for SLOT_RESERVED (50%)
/// @notice Phase 1: Steward Council >=75% vote authorizes Reserved spending.
///         Phase B: setPhaseB(daoGovernor) transfers owner to DAOGovernor.
contract ReservedExpensesPoolV3 is ReentrancyGuard {
    address public owner;
    bool    public isPhaseB;
    IStewardCouncil public immutable council;
    ISeedBudgetV5c  public immutable seedBudget;
    uint8 public constant SLOT_RESERVED = 3;

    uint16 public threshold; // bps, default 7500 = 75%

    struct Order {
        address proposer;
        address recipient;
        uint256 amount;
        string  content;
        uint256 approvalCount;
        bool    executed;
        bool    cancelled;
    }
    mapping(uint256 => Order) public orders;
    mapping(uint256 => mapping(address => bool)) public approvals;
    uint256 public nextOrderId;

    event OrderCreated(uint256 indexed id, address proposer, address recipient, uint256 amount, string content);
    event OrderApproved(uint256 indexed id, address by);
    event OrderExecuted(uint256 indexed id);
    event OrderCancelled(uint256 indexed id);
    event ThresholdUpdated(uint16 newBps);
    event PhaseBActivated(address newOwner);

    modifier onlyOwner() { require(msg.sender == owner, "REPv3: not owner"); _; }

    constructor(address _council, address _seedBudget, address _owner) {
        require(_council != address(0), "REPv3: zero council");
        require(_seedBudget != address(0), "REPv3: zero seedBudget");
        require(_owner != address(0), "REPv3: zero owner");
        council    = IStewardCouncil(_council);
        seedBudget = ISeedBudgetV5c(_seedBudget);
        owner      = _owner;
        threshold  = 7500; // 75%
    }

    /// @notice Create a new spending order for Reserved slot. Only Council members or owner can create.
    function createOrder(address recipient, uint256 amount, string calldata content) external returns (uint256) {
        require(council.isMember(msg.sender) || msg.sender == owner, "REPv3: not council");
        require(recipient != address(0), "REPv3: zero recipient");
        require(amount > 0, "REPv3: zero amount");
        uint256 id = ++nextOrderId;
        orders[id] = Order({
            proposer: msg.sender,
            recipient: recipient,
            amount: amount,
            content: content,
            approvalCount: 0,
            executed: false,
            cancelled: false
        });
        emit OrderCreated(id, msg.sender, recipient, amount, content);
        return id;
    }

    /// @notice Council member approves an order. 1 vote per member.
    function approveOrder(uint256 id) external {
        require(council.isMember(msg.sender), "REPv3: not council member");
        Order storage o = orders[id];
        require(o.proposer != address(0), "REPv3: order not found");
        require(!o.executed && !o.cancelled, "REPv3: order closed");
        require(!approvals[id][msg.sender], "REPv3: already approved");
        approvals[id][msg.sender] = true;
        o.approvalCount += 1;
        emit OrderApproved(id, msg.sender);
    }

    /// @notice Execute order if approvals >= threshold of activeCount.
    function executeOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        require(o.proposer != address(0), "REPv3: order not found");
        require(!o.executed && !o.cancelled, "REPv3: order closed");

        uint256 active = council.activeCount();
        require(active > 0, "REPv3: no active members");
        // required = ceil(active * threshold / 10000)
        uint256 required = (active * threshold + 9999) / 10000;
        require(o.approvalCount >= required, "REPv3: insufficient approvals");
        require(seedBudget.slotBalance(SLOT_RESERVED) >= o.amount, "REPv3: insufficient slot balance");

        o.executed = true;
        seedBudget.release(SLOT_RESERVED, o.recipient, o.amount);
        emit OrderExecuted(id);
    }

    /// @notice Cancel an order before execution. Owner OR proposer can cancel.
    function cancelOrder(uint256 id) external {
        Order storage o = orders[id];
        require(o.proposer != address(0), "REPv3: order not found");
        require(!o.executed && !o.cancelled, "REPv3: order closed");
        require(msg.sender == owner || msg.sender == o.proposer, "REPv3: not authorized");
        o.cancelled = true;
        emit OrderCancelled(id);
    }

    /// @notice Update voting threshold (bps). Range [5000, 10000] = [50%, 100%].
    function setThreshold(uint16 newBps) external onlyOwner {
        require(newBps >= 5000 && newBps <= 10000, "REPv3: threshold out of range");
        threshold = newBps;
        emit ThresholdUpdated(newBps);
    }

    /// @notice Activate Phase B: transfer owner to DAOGovernor. One-way.
    function setPhaseB(address newOwner) external onlyOwner {
        require(!isPhaseB, "REPv3: already Phase B");
        require(newOwner != address(0), "REPv3: zero newOwner");
        isPhaseB = true;
        owner = newOwner;
        emit PhaseBActivated(newOwner);
    }
}
