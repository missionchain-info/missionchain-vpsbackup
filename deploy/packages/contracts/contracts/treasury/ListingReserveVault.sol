// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ListingReserveVault — 73.5M MIC reserved for external CEX/DEX listings
/// @notice
///   - Holds the 73.5M MIC slice of the original 105M LP allocation.
///   - The other 31.5M MIC stays in LiquidityPool v5 for closed-loop swap.
///   - Withdrawals follow 2-step pattern: requestWithdraw → 7-day cooldown →
///     anyone can executeWithdraw.
///   - Owner can cancel any pending request before execution.
///   - Phase 1: Owner controls. Mainnet: transfer ownership to DAOGovernor.
contract ListingReserveVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable owner;
    IERC20  public immutable mic;

    uint256 public constant COOLDOWN = 7 days;

    enum RequestStatus { PENDING, EXECUTED, CANCELLED }

    struct WithdrawRequest {
        uint256 id;
        address recipient;
        uint256 amount;
        string  exchange;       // "PancakeSwap" / "Binance" / "Bybit" / etc.
        string  reason;
        address requester;
        uint64  createdAt;
        uint64  cooldownEnd;
        RequestStatus status;
        uint64  executedAt;
    }

    mapping(uint256 => WithdrawRequest) public requests;
    uint256 public nextRequestId;

    uint256 public totalWithdrawn;

    event WithdrawRequested(uint256 indexed id, address indexed recipient, uint256 amount, string exchange, uint64 cooldownEnd);
    event WithdrawExecuted(uint256 indexed id, address indexed recipient, uint256 amount);
    event WithdrawCancelled(uint256 indexed id, address indexed by);

    modifier onlyOwner() {
        require(msg.sender == owner, "LRV: not owner");
        _;
    }

    constructor(address _mic, address _owner) {
        require(_mic != address(0), "LRV: zero mic");
        require(_owner != address(0), "LRV: zero owner");
        mic   = IERC20(_mic);
        owner = _owner;
    }

    /// @notice Owner creates a withdrawal request — 7-day cooldown before execute.
    /// @param recipient CEX/DEX deposit address
    /// @param amount    MIC amount (18 decimals)
    /// @param exchange  Exchange name for audit ("Binance", "PancakeSwap", etc.)
    /// @param reason    Free-text reason / context
    function requestWithdraw(
        address recipient,
        uint256 amount,
        string calldata exchange,
        string calldata reason
    ) external onlyOwner returns (uint256 id) {
        require(recipient != address(0), "LRV: zero recipient");
        require(amount > 0, "LRV: zero amount");
        require(amount <= mic.balanceOf(address(this)), "LRV: insufficient balance");

        id = ++nextRequestId;
        uint64 cooldownEnd = uint64(block.timestamp + COOLDOWN);
        requests[id] = WithdrawRequest({
            id:          id,
            recipient:   recipient,
            amount:      amount,
            exchange:    exchange,
            reason:      reason,
            requester:   msg.sender,
            createdAt:   uint64(block.timestamp),
            cooldownEnd: cooldownEnd,
            status:      RequestStatus.PENDING,
            executedAt:  0
        });
        emit WithdrawRequested(id, recipient, amount, exchange, cooldownEnd);
    }

    /// @notice Anyone can call after cooldown.
    function executeWithdraw(uint256 id) external nonReentrant {
        WithdrawRequest storage r = requests[id];
        require(r.id == id && id != 0, "LRV: invalid id");
        require(r.status == RequestStatus.PENDING, "LRV: not pending");
        require(block.timestamp >= r.cooldownEnd, "LRV: cooldown active");
        require(r.amount <= mic.balanceOf(address(this)), "LRV: insufficient balance");

        r.status     = RequestStatus.EXECUTED;
        r.executedAt = uint64(block.timestamp);
        totalWithdrawn += r.amount;

        mic.safeTransfer(r.recipient, r.amount);
        emit WithdrawExecuted(id, r.recipient, r.amount);
    }

    /// @notice Owner cancels any pending request.
    function cancelWithdraw(uint256 id) external onlyOwner {
        WithdrawRequest storage r = requests[id];
        require(r.id == id && id != 0, "LRV: invalid id");
        require(r.status == RequestStatus.PENDING, "LRV: not pending");
        r.status = RequestStatus.CANCELLED;
        emit WithdrawCancelled(id, msg.sender);
    }

    function vaultBalance() external view returns (uint256) { return mic.balanceOf(address(this)); }
    function getRequest(uint256 id) external view returns (WithdrawRequest memory) { return requests[id]; }
}
