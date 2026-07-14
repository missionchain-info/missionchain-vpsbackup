// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IStewardCouncil {
    function isActiveMember(address wallet) external view returns (bool);
    function activeCount() external view returns (uint256);
}

/// @title ManagementBonusPool — 10% of SEED revenue, governed by Steward Council vote
/// @notice
///   - Receives USDT from SeedBudget via receiveAndDistribute() (no auto-split).
///   - Council members create bonus orders (recipient, amount, content).
///   - Council members vote (1 vote each in Phase 1).
///   - When approval ratio reaches `thresholdBps` (default 7500 = 75%), order
///     becomes executable. Anyone can call execute() to finalize on-chain transfer.
///   - Owner can cancel any PENDING order before execution.
///   - Threshold is configurable by Owner.
///
/// @dev Phase 1 = simple member voting. Phase 2 (DAO) will add MFP-NFT weighted votes.
contract ManagementBonusPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable owner;
    address public distributor; // SeedBudget contract — set by owner after deploy

    IERC20 public immutable usdt;
    IStewardCouncil public immutable council;

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
        // approvals tracked separately to avoid struct storage overhead
    }

    mapping(uint256 => BonusOrder) public orders;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint256 => uint256) public approvalsCount;
    uint256 public nextOrderId;

    /// @notice total USDT received from SeedBudget (cumulative)
    uint256 public totalReceived;
    /// @notice total USDT executed via approved orders
    uint256 public totalExecuted;

    event OrderCreated(uint256 indexed id, address indexed requester, address indexed recipient, uint256 amount, string content);
    event OrderApproved(uint256 indexed id, address indexed voter, uint256 approvalsCount, uint256 activeCouncil);
    event OrderExecuted(uint256 indexed id, address indexed recipient, uint256 amount);
    event OrderCancelled(uint256 indexed id, address indexed by);
    event ThresholdUpdated(uint16 oldBps, uint16 newBps);
    event DistributorSet(address distributor);
    event Received(uint256 amount, uint256 totalReceived);

    modifier onlyOwner() {
        require(msg.sender == owner, "MBP: not owner");
        _;
    }
    modifier onlyDistributor() {
        require(msg.sender == distributor, "MBP: not distributor");
        _;
    }
    modifier onlyCouncil() {
        require(council.isActiveMember(msg.sender), "MBP: not active council");
        _;
    }

    constructor(address _usdt, address _council, address _owner) {
        require(_usdt != address(0), "MBP: zero usdt");
        require(_council != address(0), "MBP: zero council");
        require(_owner != address(0), "MBP: zero owner");
        usdt    = IERC20(_usdt);
        council = IStewardCouncil(_council);
        owner   = _owner;
    }

    // ─── Owner config ────────────────────────────────────────────────────

    function setDistributor(address _distributor) external onlyOwner {
        distributor = _distributor;
        emit DistributorSet(_distributor);
    }

    function setThreshold(uint16 newBps) external onlyOwner {
        require(newBps > 0 && newBps <= 10_000, "MBP: invalid bps");
        emit ThresholdUpdated(thresholdBps, newBps);
        thresholdBps = newBps;
    }

    // ─── Distributor: receive USDT from SeedBudget ───────────────────────

    function receiveAndDistribute(uint256 amount) external onlyDistributor nonReentrant {
        require(amount > 0, "MBP: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        totalReceived += amount;
        emit Received(amount, totalReceived);
    }

    // ─── Council: create / vote / execute / cancel orders ────────────────

    function createOrder(address recipient, uint256 amount, string calldata content)
        external
        onlyCouncil
        returns (uint256 id)
    {
        require(recipient != address(0), "MBP: zero recipient");
        require(amount > 0, "MBP: zero amount");
        require(amount <= usdt.balanceOf(address(this)) + totalExecuted, "MBP: exceeds total received");

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
        require(o.id == id && id != 0, "MBP: invalid order");
        require(o.status == OrderStatus.PENDING, "MBP: not pending");
        require(!hasVoted[id][msg.sender], "MBP: already voted");

        hasVoted[id][msg.sender] = true;
        approvalsCount[id]++;

        emit OrderApproved(id, msg.sender, approvalsCount[id], council.activeCount());
    }

    /// @notice Anyone can call this once threshold is reached.
    function executeOrder(uint256 id) external nonReentrant {
        BonusOrder storage o = orders[id];
        require(o.id == id && id != 0, "MBP: invalid order");
        require(o.status == OrderStatus.PENDING, "MBP: not pending");

        uint256 active = council.activeCount();
        require(active > 0, "MBP: no active council");
        // approvals * 10000 / active >= thresholdBps
        require(approvalsCount[id] * 10_000 >= active * thresholdBps, "MBP: threshold not met");
        require(o.amount <= usdt.balanceOf(address(this)), "MBP: insufficient pool balance");

        o.status     = OrderStatus.EXECUTED;
        o.executedAt = uint64(block.timestamp);
        totalExecuted += o.amount;

        usdt.safeTransfer(o.recipient, o.amount);
        emit OrderExecuted(id, o.recipient, o.amount);
    }

    /// @notice Owner cancels any PENDING order.
    function cancelOrder(uint256 id) external onlyOwner {
        BonusOrder storage o = orders[id];
        require(o.id == id && id != 0, "MBP: invalid order");
        require(o.status == OrderStatus.PENDING, "MBP: not pending");
        o.status = OrderStatus.CANCELLED;
        emit OrderCancelled(id, msg.sender);
    }

    // ─── Views ───────────────────────────────────────────────────────────

    function poolBalance() external view returns (uint256) { return usdt.balanceOf(address(this)); }
    function getOrder(uint256 id) external view returns (BonusOrder memory) { return orders[id]; }
    function isApproved(uint256 id, address voter) external view returns (bool) { return hasVoted[id][voter]; }

    function approvalRatioBps(uint256 id) external view returns (uint256) {
        uint256 active = council.activeCount();
        if (active == 0) return 0;
        return (approvalsCount[id] * 10_000) / active;
    }
}
