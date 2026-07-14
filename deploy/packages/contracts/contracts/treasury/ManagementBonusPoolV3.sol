// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IStewardCouncil {
    function isActiveMember(address wallet) external view returns (bool);
    function activeCount() external view returns (uint256);
}

interface ISeedBudgetV5c {
    function release(uint8 slot, address recipient, uint256 amount) external;
    function slotBalance(uint8 slot) external view returns (uint256);
}

/// @notice V3 redeploy points to SeedBudgetV5c. Same Council voting logic as V2.
/// @title ManagementBonusPoolV3 — Policy contract for SEED Mgmt Bonus slot (10%)
/// @notice
///   Does NOT hold USDT. Holds order/vote state only. When threshold (default 75%)
///   is reached, anyone can call executeOrder() which calls
///   SeedBudgetV5c.release(SLOT_MGMT_BONUS, recipient, amount) to disburse.
contract ManagementBonusPoolV3 is ReentrancyGuard {
    address public immutable owner;
    IStewardCouncil public immutable council;
    ISeedBudgetV5c public immutable seedBudget;

    uint8 public constant SLOT_MGMT_BONUS = 2;

    /// @notice Approval threshold in BPS (7500 = 75%). Owner can update.
    uint16 public thresholdBps = 7500;

    enum OrderStatus { PENDING, EXECUTED, CANCELLED }

    struct BonusOrder {
        uint256 id;
        address recipient;
        uint256 amount;
        string  content;
        address requester;
        uint64  createdAt;
        OrderStatus status;
        uint64  executedAt;
    }

    mapping(uint256 => BonusOrder) public orders;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => uint256) public approvalsCount;
    uint256 public nextOrderId;

    event OrderCreated(uint256 indexed id, address indexed requester, address indexed recipient, uint256 amount, string content);
    event OrderApproved(uint256 indexed id, address indexed voter, uint256 approvals, uint256 active);
    event OrderExecuted(uint256 indexed id, address indexed recipient, uint256 amount);
    event OrderCancelled(uint256 indexed id, address indexed by);
    event ThresholdUpdated(uint16 oldBps, uint16 newBps);

    modifier onlyOwner()    { require(msg.sender == owner, "MBPv3: not owner"); _; }
    modifier onlyCouncil()  { require(council.isActiveMember(msg.sender), "MBPv3: not active council"); _; }

    constructor(address _council, address _seedBudget, address _owner) {
        require(_council    != address(0), "MBPv3: zero council");
        require(_seedBudget != address(0), "MBPv3: zero seedBudget");
        require(_owner      != address(0), "MBPv3: zero owner");
        council    = IStewardCouncil(_council);
        seedBudget = ISeedBudgetV5c(_seedBudget);
        owner      = _owner;
    }

    // ─── Owner config ────────────────────────────────────────────────────

    function setThreshold(uint16 newBps) external onlyOwner {
        require(newBps > 0 && newBps <= 10_000, "MBPv3: invalid bps");
        emit ThresholdUpdated(thresholdBps, newBps);
        thresholdBps = newBps;
    }

    // ─── Council: create / vote / execute / cancel ───────────────────────

    function createOrder(address recipient, uint256 amount, string calldata content)
        external
        onlyCouncil
        returns (uint256 id)
    {
        require(recipient != address(0), "MBPv3: zero recipient");
        require(amount > 0, "MBPv3: zero amount");

        id = ++nextOrderId;
        orders[id] = BonusOrder({
            id:         id,
            recipient:  recipient,
            amount:     amount,
            content:    content,
            requester:  msg.sender,
            createdAt:  uint64(block.timestamp),
            status:     OrderStatus.PENDING,
            executedAt: 0
        });
        emit OrderCreated(id, msg.sender, recipient, amount, content);
    }

    function approveOrder(uint256 id) external onlyCouncil {
        BonusOrder storage o = orders[id];
        require(o.id == id && id != 0, "MBPv3: invalid order");
        require(o.status == OrderStatus.PENDING, "MBPv3: not pending");
        require(!hasVoted[id][msg.sender], "MBPv3: already voted");
        hasVoted[id][msg.sender] = true;
        approvalsCount[id]++;
        emit OrderApproved(id, msg.sender, approvalsCount[id], council.activeCount());
    }

    function executeOrder(uint256 id) external nonReentrant {
        BonusOrder storage o = orders[id];
        require(o.id == id && id != 0, "MBPv3: invalid order");
        require(o.status == OrderStatus.PENDING, "MBPv3: not pending");

        uint256 active = council.activeCount();
        require(active > 0, "MBPv3: no active council");
        require(approvalsCount[id] * 10_000 >= active * thresholdBps, "MBPv3: threshold not met");
        require(seedBudget.slotBalance(SLOT_MGMT_BONUS) >= o.amount, "MBPv3: insufficient slot balance");

        o.status     = OrderStatus.EXECUTED;
        o.executedAt = uint64(block.timestamp);

        seedBudget.release(SLOT_MGMT_BONUS, o.recipient, o.amount);
        emit OrderExecuted(id, o.recipient, o.amount);
    }

    function cancelOrder(uint256 id) external onlyOwner {
        BonusOrder storage o = orders[id];
        require(o.id == id && id != 0, "MBPv3: invalid order");
        require(o.status == OrderStatus.PENDING, "MBPv3: not pending");
        o.status = OrderStatus.CANCELLED;
        emit OrderCancelled(id, msg.sender);
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function getOrder(uint256 id) external view returns (BonusOrder memory) { return orders[id]; }
    function isApproved(uint256 id, address voter) external view returns (bool) { return hasVoted[id][voter]; }
    function approvalRatioBps(uint256 id) external view returns (uint256) {
        uint256 active = council.activeCount();
        if (active == 0) return 0;
        return (approvalsCount[id] * 10_000) / active;
    }
}
