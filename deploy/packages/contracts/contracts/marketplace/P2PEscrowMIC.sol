// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ITreasuryManager {
    function receiveUSDT(uint256 amount) external;
}

/// @title P2PEscrowMIC — peer-to-peer MIC ↔ USDT at a price the two sides agree
/// @notice A seller escrows MIC and names a total USDT price. A buyer pays that price and
///         both legs settle in one transaction. No pool, no curve, no slippage — this is a
///         private sale with the contract standing in for trust.
///
/// @dev ## Both tokens are 18 decimals, and the constructor refuses anything else
///
/// BSC-USD `0x55d398326f99059fF775485246999027B3197955` has **18** decimals, not the 6 of
/// Ethereum's USDT. That assumption has now been wrong six times in this codebase. Twice it
/// nearly gave away nine-figure MIC balances for a millionth of a dollar; in P2PEscrowMFP
/// (deployed 2026-05-10, found 2026-08-11) it set a maximum listing price of $0.000001, so
/// every honest listing reverted and the marketplace sat unusable for three months.
///
/// A comment saying "18 decimals" did not stop any of those — `deploy/CLAUDE.md` already
/// said so and was ignored. Only an executable check stops it, so the constructor reads
/// `decimals()` off both tokens and reverts. The bounds below are written with `e18` and
/// their meaning is stated in dollars so a wrong one is visible on inspection.
///
/// ## Locked MIC
///
/// MICToken enforces `balance - value >= locked` on every transfer. A seller whose MIC is
/// under vesting simply cannot escrow it — `createOrder` reverts inside the token, which is
/// the correct outcome. Nothing here tries to work around a lock.
contract P2PEscrowMIC is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant VERSION = "P2PEscrowMIC-v1.0.0";

    // ─── Bounds ──────────────────────────────────────────────────────────────
    // Every figure is 18-decimal. The dollar value is spelled out so a wrong exponent is
    // readable rather than buried in zeros.

    uint16 public constant MIN_FEE_BPS = 0;        // 0%
    uint16 public constant MAX_FEE_BPS = 1000;     // 10%
    uint16 public feeBps = 150;                    // 1.5%

    // Adjustable, on purpose. P2PEscrowMFP wrote its bounds as `constant` and shipped a
    // $0.000001 ceiling that no setter could reach, so a redeploy is the only cure -- and
    // the first draft of THIS contract repeated the same shape before the floor needed to
    // move from $1 to $0.10. A bound the Owner may reasonably want to tune is a parameter,
    // not a constant. The hard ceilings below still fence a fat-fingered call.
    uint256 public minPriceUsdt = 0.005e18;        // $0.005 -- the price of one MIC, so a
                                                   // single-coin lot is listable
    uint256 public maxPriceUsdt = 1_000_000e18;    // $1,000,000

    uint256 public minAmountMic = 1e18;            // 1 MIC
    uint256 public maxAmountMic = 100_000_000e18;  // 100,000,000 MIC

    /// Outer fences. These are genuinely fixed: nothing legitimate lives outside them, and
    /// they stop a mistyped setter from reopening the hole this contract exists to avoid.
    uint256 public constant FLOOR_PRICE_USDT = 0.001e18;        // $0.001 -- never lower
    uint256 public constant CEILING_PRICE_USDT = 100_000_000e18; // $100,000,000 -- never higher

    uint256 public constant MIN_EXPIRY_SECONDS = 1 hours;
    uint256 public constant MAX_EXPIRY_SECONDS = 30 days;

    address public feeRecipient;
    bool public paused;

    IERC20 public immutable usdt;
    IERC20 public immutable mic;

    // ─── Orders ──────────────────────────────────────────────────────────────

    enum Status { PENDING, EXECUTED, CANCELLED, EXPIRED }

    struct Order {
        uint256 id;
        address seller;
        uint256 amountMic;   // escrowed and held by this contract
        uint256 priceUsdt;   // total for the whole lot, not per MIC
        uint64  createdAt;
        uint64  expiresAt;
        Status  status;
        address buyer;
        uint64  closedAt;
    }

    mapping(uint256 => Order) public orders;
    uint256 public nextOrderId;

    /// Escrowed MIC belonging to open orders. Anything above this is a stray transfer and
    /// is the only thing an admin may sweep — seller funds can never be reached.
    uint256 public totalEscrowedMic;

    event OrderCreated(
        uint256 indexed id,
        address indexed seller,
        uint256 amountMic,
        uint256 priceUsdt,
        uint64  expiresAt
    );
    event OrderExecuted(
        uint256 indexed id,
        address indexed buyer,
        uint256 priceUsdt,
        uint256 feeAmount,
        uint256 sellerNet
    );
    event OrderCancelled(uint256 indexed id, address indexed by);
    event OrderExpired(uint256 indexed id, address indexed by);

    event FeeUpdated(uint16 oldBps, uint16 newBps);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event PausedSet(bool paused);
    event PriceBoundsUpdated(uint256 oldMin, uint256 oldMax, uint256 newMin, uint256 newMax);
    event AmountBoundsUpdated(uint256 oldMin, uint256 oldMax, uint256 newMin, uint256 newMax);
    event StraySwept(address indexed token, address indexed to, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────

    constructor(address _usdt, address _mic, address _feeRecipient, address _admin) {
        require(_usdt != address(0) && _mic != address(0), "P2P: zero token");
        require(_feeRecipient != address(0), "P2P: zero recipient");
        require(_admin != address(0), "P2P: zero admin");

        // The guard that the last six incidents needed and did not have.
        require(IERC20Metadata(_usdt).decimals() == 18, "P2P: USDT must be 18 decimals");
        require(IERC20Metadata(_mic).decimals() == 18, "P2P: MIC must be 18 decimals");

        usdt = IERC20(_usdt);
        mic = IERC20(_mic);
        feeRecipient = _feeRecipient;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    modifier notPaused() {
        require(!paused, "P2P: paused");
        _;
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function getOrder(uint256 id) external view returns (Order memory) {
        return orders[id];
    }

    function isExpired(uint256 id) external view returns (bool) {
        Order storage o = orders[id];
        return o.status == Status.PENDING && block.timestamp >= o.expiresAt;
    }

    /// @notice USDT the buyer pays, and what the seller receives after fee. Quoted before
    ///         anyone signs, so neither side learns the fee from the receipt.
    function quote(uint256 id) external view returns (uint256 buyerPays, uint256 sellerReceives) {
        Order storage o = orders[id];
        buyerPays = o.priceUsdt;
        sellerReceives = o.priceUsdt - (o.priceUsdt * feeBps) / 10_000;
    }

    // ─── Seller ──────────────────────────────────────────────────────────────

    /// @notice Escrow `amountMic` and offer the whole lot for `priceUsdt`.
    /// @dev The MIC moves here immediately. A seller cannot promise coins they have already
    ///      spent, and a buyer is never asked to trust that the seller still holds them.
    function createOrder(uint256 amountMic, uint256 priceUsdt, uint64 expirySeconds)
        external
        nonReentrant
        notPaused
        returns (uint256 id)
    {
        require(amountMic >= minAmountMic && amountMic <= maxAmountMic, "P2P: amount out of range");
        require(priceUsdt >= minPriceUsdt && priceUsdt <= maxPriceUsdt, "P2P: price out of range");
        require(
            expirySeconds >= MIN_EXPIRY_SECONDS && expirySeconds <= MAX_EXPIRY_SECONDS,
            "P2P: expiry out of range"
        );

        // Measure what actually arrived. A fee-on-transfer token would otherwise leave the
        // order promising more MIC than the contract holds, and the last buyer would find
        // the cupboard bare. MIC does not take a fee today; this does not depend on that.
        uint256 before = mic.balanceOf(address(this));
        mic.safeTransferFrom(msg.sender, address(this), amountMic);
        uint256 received = mic.balanceOf(address(this)) - before;
        require(received == amountMic, "P2P: MIC transfer shortfall");

        id = nextOrderId++;
        orders[id] = Order({
            id: id,
            seller: msg.sender,
            amountMic: amountMic,
            priceUsdt: priceUsdt,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + expirySeconds),
            status: Status.PENDING,
            buyer: address(0),
            closedAt: 0
        });
        totalEscrowedMic += amountMic;

        emit OrderCreated(id, msg.sender, amountMic, priceUsdt, orders[id].expiresAt);
    }

    /// @notice Seller withdraws an unsold order and takes the MIC back.
    /// @dev No cancellation fee. Withdrawing an offer nobody accepted is not a wrong, and
    ///      charging for it would only punish sellers who reprice honestly.
    function cancelOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        require(o.status == Status.PENDING, "P2P: not open");
        require(o.seller == msg.sender, "P2P: not seller");

        o.status = Status.CANCELLED;
        o.closedAt = uint64(block.timestamp);
        totalEscrowedMic -= o.amountMic;

        mic.safeTransfer(o.seller, o.amountMic);
        emit OrderCancelled(id, msg.sender);
    }

    // ─── Buyer ───────────────────────────────────────────────────────────────

    /// @notice Pay the asking price and take the MIC. Both legs settle here or neither does.
    /// @param id           the order being filled
    /// @param maxPriceUsdt the most the buyer will pay
    /// @dev `maxPriceUsdt` is not ceremony. The seller cannot change a live order today, but
    ///      a buyer signing against a stale screen deserves to fail rather than overpay, and
    ///      it keeps that guarantee if repricing is ever added.
    function matchOrder(uint256 id, uint256 maxPriceUsdt) external nonReentrant notPaused {
        Order storage o = orders[id];
        require(o.status == Status.PENDING, "P2P: not open");
        require(block.timestamp < o.expiresAt, "P2P: expired");
        require(msg.sender != o.seller, "P2P: self-trade");
        require(o.priceUsdt <= maxPriceUsdt, "P2P: price moved");

        uint256 fee = (o.priceUsdt * feeBps) / 10_000;
        uint256 sellerNet = o.priceUsdt - fee;

        o.status = Status.EXECUTED;
        o.buyer = msg.sender;
        o.closedAt = uint64(block.timestamp);
        totalEscrowedMic -= o.amountMic;

        // USDT: buyer → seller, and buyer → fee recipient. Straight through, never pooled
        // here, so a stuck balance cannot strand anyone's proceeds.
        usdt.safeTransferFrom(msg.sender, o.seller, sellerNet);
        if (fee > 0) {
            usdt.safeTransferFrom(msg.sender, feeRecipient, fee);
        }

        mic.safeTransfer(msg.sender, o.amountMic);

        emit OrderExecuted(id, msg.sender, o.priceUsdt, fee, sellerNet);
    }

    // ─── Expiry ──────────────────────────────────────────────────────────────

    /// @notice Return an expired order's MIC to its seller. Callable by anyone.
    /// @dev Deliberately permissionless: the MIC goes to the seller no matter who calls, so
    ///      there is nothing to gain by calling and a seller is never locked out because a
    ///      keeper was down.
    function expireOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        require(o.status == Status.PENDING, "P2P: not open");
        require(block.timestamp >= o.expiresAt, "P2P: not yet expired");

        o.status = Status.EXPIRED;
        o.closedAt = uint64(block.timestamp);
        totalEscrowedMic -= o.amountMic;

        mic.safeTransfer(o.seller, o.amountMic);
        emit OrderExpired(id, msg.sender);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setFee(uint16 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newBps >= MIN_FEE_BPS && newBps <= MAX_FEE_BPS, "P2P: fee out of range");
        emit FeeUpdated(feeBps, newBps);
        feeBps = newBps;
    }

    /// @notice Move the accepted price range. Stated in 18-decimal USDT: $0.10 is `0.1e18`.
    function setPriceBounds(uint256 newMin, uint256 newMax) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMin >= FLOOR_PRICE_USDT, "P2P: min below floor");
        require(newMax <= CEILING_PRICE_USDT, "P2P: max above ceiling");
        require(newMin < newMax, "P2P: min must be below max");
        emit PriceBoundsUpdated(minPriceUsdt, maxPriceUsdt, newMin, newMax);
        minPriceUsdt = newMin;
        maxPriceUsdt = newMax;
    }

    /// @notice Move the accepted lot size. Stated in 18-decimal MIC.
    function setAmountBounds(uint256 newMin, uint256 newMax) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMin > 0, "P2P: zero min amount");
        require(newMin < newMax, "P2P: min must be below max");
        emit AmountBoundsUpdated(minAmountMic, maxAmountMic, newMin, newMax);
        minAmountMic = newMin;
        maxAmountMic = newMax;
    }

    function setFeeRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRecipient != address(0), "P2P: zero recipient");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    /// @notice Stop new orders and new fills. Cancel and expire stay open by design — a
    ///         pause must never trap a seller's escrow.
    function setPaused(bool p) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Sweep tokens sent here by mistake.
    /// @dev For MIC this can only ever take the surplus above `totalEscrowedMic`, so no
    ///      admin — compromised or otherwise — can reach coins that belong to an open order.
    ///      USDT is never held here at all, so any USDT balance is by definition a stray.
    function sweepStray(address token, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(to != address(0), "P2P: zero to");
        if (token == address(mic)) {
            uint256 balance = mic.balanceOf(address(this));
            require(balance > totalEscrowedMic, "P2P: no stray MIC");
            require(amount <= balance - totalEscrowedMic, "P2P: would touch escrow");
        }
        IERC20(token).safeTransfer(to, amount);
        emit StraySwept(token, to, amount);
    }
}
