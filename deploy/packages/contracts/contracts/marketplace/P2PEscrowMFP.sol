// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

interface ITreasuryManager {
    function receiveUSDT(uint256 amount) external;
}

/// @title P2PEscrowMFP — Internal P2P marketplace for Mission Founders Pass NFT
/// @notice Phase 1: fixed-price, ERC-721 only (MFP-NFT). Atomic settlement.
/// @dev See docs/superpowers/specs/2026-05-03-p2p-exchange-mfp-design.md
contract P2PEscrowMFP is AccessControl, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    string public constant VERSION = "P2PEscrowMFP-v1.0.0";

    // Fee bounds
    uint16 public constant MIN_FEE_BPS = 50;       // 0.5%
    uint16 public constant MAX_FEE_BPS = 1000;     // 10%
    uint16 public feeBps = 150;                    // 1.5% default
    address public feeRecipient;                   // TreasuryManager

    // Royalty sanity bound
    uint16 public constant MAX_ROYALTY_BPS = 2000; // 20% cap

    // Price bounds
    uint256 public constant MIN_PRICE_USDT = 100e6;
    uint256 public constant MAX_PRICE_USDT = 1_000_000e6;

    // Expiry bounds
    uint256 public constant MIN_EXPIRY_SECONDS = 1 days;
    uint256 public constant MAX_EXPIRY_SECONDS = 15 days;

    // Cancellation fee
    uint256 public cancellationFeeUsdt = 10e6;
    uint256 public constant MAX_CANCELLATION_FEE = 1000e6;

    IERC20  public immutable usdt;
    IERC721 public immutable mfp;

    bool public paused;

    // ─────────────────────────────────────────────────────────────────────────
    // Order storage
    // ─────────────────────────────────────────────────────────────────────────

    enum Status { PENDING, EXECUTED, CANCELLED, EXPIRED }

    struct Order {
        uint256 id;
        address seller;
        uint256 tokenId;
        uint256 priceUsdt;
        uint64  createdAt;
        uint64  expiresAt;
        Status  status;
        address buyer;
        uint64  closedAt;
    }

    mapping(uint256 => Order) public orders;
    uint256 public nextOrderId;
    mapping(uint256 => uint256) public tokenToActiveOrder;

    event OrderCreated(
        uint256 indexed id,
        address indexed seller,
        uint256 indexed tokenId,
        uint256 priceUsdt,
        uint64  expiresAt
    );

    event OrderExecuted(uint256 indexed id, address indexed buyer, uint256 priceUsdt,
        uint256 royaltyAmount, uint256 feeAmount, uint256 sellerNet);

    event OrderCancelled(uint256 indexed id, address indexed by, uint256 cancellationFeePaid);
    event OrderExpired(uint256 indexed id, address indexed by);

    // Admin events
    event FeeUpdated(uint16 oldBps, uint16 newBps);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event CancellationFeeUpdated(uint256 oldUsdt, uint256 newUsdt);
    event Paused(bool paused);
    event EmergencyRecovered(uint256 indexed orderId, address indexed to);

    // ─────────────────────────────────────────────────────────────────────────

    constructor(address _usdt, address _mfp, address _feeRecipient, address _admin) {
        require(_usdt != address(0) && _mfp != address(0), "P2P: zero token");
        require(_feeRecipient != address(0), "P2P: zero recipient");
        require(_admin != address(0), "P2P: zero admin");
        usdt = IERC20(_usdt);
        mfp = IERC721(_mfp);
        feeRecipient = _feeRecipient;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    /// @notice IERC721Receiver — required so safeTransferFrom(seller, this, tokenId) succeeds
    function onERC721Received(address, address, uint256, bytes calldata)
        external pure override returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns the active order id for a given token (0 if none).
    function activeOrderForToken(uint256 tokenId) external view returns (uint256) {
        return tokenToActiveOrder[tokenId];
    }

    /// @notice Returns true if the order is PENDING and past its expiry.
    function isExpired(uint256 id) external view returns (bool) {
        Order memory o = orders[id];
        return o.status == Status.PENDING && block.timestamp > o.expiresAt;
    }

    /// @notice Returns the full Order struct for a given order id.
    function getOrder(uint256 id) external view returns (Order memory) {
        return orders[id];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice List an MFP-NFT for sale at a fixed USDT price.
    /// @param tokenId      The ERC-721 token id to sell.
    /// @param priceUsdt    Sale price in USDT (6 decimals). Must be within [MIN, MAX].
    /// @param expirySeconds Listing lifetime in seconds. Must be within [MIN, MAX].
    /// @return id          The new order id.
    function createOrder(uint256 tokenId, uint256 priceUsdt, uint64 expirySeconds)
        external nonReentrant returns (uint256 id)
    {
        require(!paused, "P2P: paused");
        require(tokenToActiveOrder[tokenId] == 0, "P2P: token already listed");
        require(
            priceUsdt >= MIN_PRICE_USDT && priceUsdt <= MAX_PRICE_USDT,
            "P2P: price out of bounds"
        );
        require(
            expirySeconds >= MIN_EXPIRY_SECONDS && expirySeconds <= MAX_EXPIRY_SECONDS,
            "P2P: expiry out of bounds"
        );
        require(mfp.ownerOf(tokenId) == msg.sender, "P2P: not NFT owner");
        require(
            mfp.isApprovedForAll(msg.sender, address(this)) ||
                mfp.getApproved(tokenId) == address(this),
            "P2P: not approved"
        );

        id = ++nextOrderId;
        orders[id] = Order({
            id:        id,
            seller:    msg.sender,
            tokenId:   tokenId,
            priceUsdt: priceUsdt,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + expirySeconds),
            status:    Status.PENDING,
            buyer:     address(0),
            closedAt:  0
        });
        tokenToActiveOrder[tokenId] = id;
        mfp.safeTransferFrom(msg.sender, address(this), tokenId);
        emit OrderCreated(id, msg.sender, tokenId, priceUsdt, orders[id].expiresAt);
    }

    /// @notice Buy a listed MFP-NFT at the fixed price. Settles atomically.
    /// @dev    Atomic settlement: royalty + fee + sellerNet + NFT transfer in one tx.
    ///         CEI pattern: state changes BEFORE external calls.
    /// @param id The order id to match.
    function matchOrder(uint256 id) external nonReentrant {
        require(!paused, "P2P: paused");
        Order storage o = orders[id];
        require(o.status == Status.PENDING, "P2P: not pending");
        require(block.timestamp <= o.expiresAt, "P2P: expired");
        require(msg.sender != o.seller, "P2P: cannot buy own listing");

        // Royalty (lenient — skip if zero, sanity cap at 20%)
        (address royaltyReceiver, uint256 royaltyAmount) =
            IERC2981(address(mfp)).royaltyInfo(o.tokenId, o.priceUsdt);
        require(royaltyAmount <= (o.priceUsdt * MAX_ROYALTY_BPS) / 10000, "P2P: royalty cap exceeded");

        // Platform fee
        uint256 feeAmount = (o.priceUsdt * feeBps) / 10000;

        // A3 defensive — prevents Solidity 0.8 underflow with clear message
        require(royaltyAmount + feeAmount < o.priceUsdt, "P2P: royalty+fee exceeds price");
        uint256 sellerNet = o.priceUsdt - royaltyAmount - feeAmount;

        // CEI: state changes BEFORE external calls
        o.status = Status.EXECUTED;
        o.buyer = msg.sender;
        o.closedAt = uint64(block.timestamp);
        delete tokenToActiveOrder[o.tokenId];

        // B6: direct buyer→destination transfers (saves ~60K gas vs pull-then-push)
        usdt.safeTransferFrom(msg.sender, o.seller, sellerNet);
        if (royaltyAmount > 0 && royaltyReceiver != address(0)) {
            usdt.safeTransferFrom(msg.sender, royaltyReceiver, royaltyAmount);
        }
        if (feeAmount > 0) {
            // Pull fee to this contract, then forward to TreasuryManager via receiveUSDT
            usdt.safeTransferFrom(msg.sender, address(this), feeAmount);
            usdt.forceApprove(feeRecipient, feeAmount);
            ITreasuryManager(feeRecipient).receiveUSDT(feeAmount);
        }

        mfp.safeTransferFrom(address(this), msg.sender, o.tokenId);
        emit OrderExecuted(id, msg.sender, o.priceUsdt, royaltyAmount, feeAmount, sellerNet);
    }

    /// @notice Cancel a pending order. Charges a flat USDT cancellation fee and returns the NFT.
    /// @dev    Deliberately omits pause check — allows recovery during pause (A7).
    ///         Uses transferFrom (not safe) to prevent self-DOS via ERC721Receiver callback (A8).
    /// @param id The order id to cancel.
    function cancelOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        require(o.status == Status.PENDING, "P2P: not pending");
        require(msg.sender == o.seller, "P2P: not seller");

        if (cancellationFeeUsdt > 0) {
            usdt.safeTransferFrom(msg.sender, address(this), cancellationFeeUsdt);
            usdt.forceApprove(feeRecipient, cancellationFeeUsdt);
            ITreasuryManager(feeRecipient).receiveUSDT(cancellationFeeUsdt);
        }

        o.status = Status.CANCELLED;
        o.closedAt = uint64(block.timestamp);
        delete tokenToActiveOrder[o.tokenId];

        // A8: transferFrom (NOT safe) — recipient was lister, prevents self-DOS via callback
        mfp.transferFrom(address(this), o.seller, o.tokenId);

        emit OrderCancelled(id, msg.sender, cancellationFeeUsdt);
    }

    /// @notice Expire a pending order that is past its expiry time. Anyone can call.
    /// @dev    Deliberately omits pause check — allows recovery during pause (A7).
    ///         Uses transferFrom (not safe) to prevent self-DOS via ERC721Receiver callback (A8).
    /// @param id The order id to expire.
    function expireOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        require(o.status == Status.PENDING, "P2P: not pending");
        require(block.timestamp > o.expiresAt, "P2P: not expired yet");

        o.status = Status.EXPIRED;
        o.closedAt = uint64(block.timestamp);
        delete tokenToActiveOrder[o.tokenId];

        mfp.transferFrom(address(this), o.seller, o.tokenId);  // A8: not safe

        emit OrderExpired(id, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin functions
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Update the platform fee. Bounded to [MIN_FEE_BPS, MAX_FEE_BPS].
    function setFee(uint16 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newBps >= MIN_FEE_BPS && newBps <= MAX_FEE_BPS, "P2P: fee out of bounds");
        emit FeeUpdated(feeBps, newBps);
        feeBps = newBps;
    }

    /// @notice Update the fee recipient address.
    /// @dev    B4: zeros out stale USDT allowance to old recipient before swapping.
    function setFeeRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRecipient != address(0), "P2P: zero recipient");
        // B4: zero out stale USDT allowance to old recipient before swap
        if (feeRecipient != address(0) && feeRecipient != newRecipient) {
            usdt.forceApprove(feeRecipient, 0);
        }
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    /// @notice Update the flat cancellation fee.
    /// @dev    B6: sanity cap to prevent owner misconfig bricking all cancellations.
    function setCancellationFee(uint256 newUsdt) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newUsdt <= MAX_CANCELLATION_FEE, "P2P: cancellation fee exceeds sanity cap");
        emit CancellationFeeUpdated(cancellationFeeUsdt, newUsdt);
        cancellationFeeUsdt = newUsdt;
    }

    /// @notice Pause or unpause trading (createOrder + matchOrder).
    /// @dev    cancelOrder and expireOrder are deliberately NOT blocked (A7).
    function pauseTrading(bool _paused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = _paused;
        emit Paused(_paused);
    }

    /// @notice Emergency recover a pending order's NFT to an arbitrary address.
    /// @dev    Only callable when paused. Marks order CANCELLED. Uses transferFrom (A8: not safe).
    /// @param orderId The order to recover.
    /// @param to      The recipient address for the NFT.
    function emergencyRecoverNFT(uint256 orderId, address to)
        external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant
    {
        require(paused, "P2P: must pause first");
        Order storage o = orders[orderId];
        require(o.status == Status.PENDING, "P2P: not pending");
        require(to != address(0), "P2P: zero to");

        o.status = Status.CANCELLED;
        o.closedAt = uint64(block.timestamp);
        delete tokenToActiveOrder[o.tokenId];

        mfp.transferFrom(address(this), to, o.tokenId);  // A8: not safe

        emit EmergencyRecovered(orderId, to);
    }
}
