// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title P2PEscrowNFT — peer-to-peer ERC-721 ↔ USDT at a price the two sides agree
/// @notice One collection per deployment. Written to serve both MFP-NFT and the Community
///         NFT collection from the same audited source rather than two divergent copies.
///
/// @dev ## What this replaces, and why it is not a patch
///
/// `P2PEscrowMFP` (`0xcff2…4b8B`, deployed 2026-05-10) is unusable and cannot be repaired:
///
///   - `MAX_PRICE_USDT = 1_000_000e6`. BSC-USD has **18** decimals, so that ceiling is
///     **$0.000001**. Verified on chain 2026-08-12: a $1 listing needs 1e18 against a
///     ceiling of 1e12 and reverts. So does every larger one.
///   - Both bounds are `constant`. Four plausible setter selectors were probed against the
///     deployed bytecode — `setPriceBounds`, `setMaxPrice`, `setMinPrice`, `setPriceLimits`
///     — and none is present. There is no call that fixes it.
///   - `nextOrderId` reads 0 after three months. Not because nobody tried: because
///     `createOrder` could not succeed.
///   - It has **no bid side at all**. `createBuyOrder`, `fillBuyOrder`, `cancelBuyOrder`
///     and `nextBuyOrderId` are all absent from the bytecode, so a buyer could only ever
///     take an existing listing, never post an offer.
///
/// ## The three rules this contract is built around
///
/// 1. **18 decimals, checked in the constructor.** A comment saying so did not stop the
///    six previous occurrences of this bug — `deploy/CLAUDE.md` already said it and was
///    read past. Only an executable check stops it.
/// 2. **A bound the Owner may want to move is a parameter, not a `constant`.** That single
///    choice is what killed the contract above. Hard outer fences still apply.
///    A guard rail is not the same thing as a welded door.
/// 3. **Royalty support is asked for, never assumed.** `MFPNFT` implements ERC-2981 (5%,
///    verified on chain) but `CommunityNFTv2` does not, and calling `royaltyInfo` on it
///    reverts. An unguarded call would make every Community NFT trade fail — which is
///    exactly the shape of the bug this contract exists to replace.
contract P2PEscrowNFT is AccessControl, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    string public constant VERSION = "P2PEscrowNFT-v1.0.0";

    bytes4 private constant IID_ERC721  = 0x80ac58cd;
    bytes4 private constant IID_ERC2981 = 0x2a55205a;

    // ─── Fees ────────────────────────────────────────────────────────────────

    uint16 public constant MIN_FEE_BPS = 0;      // 0%
    uint16 public constant MAX_FEE_BPS = 1000;   // 10% — hard ceiling, never movable
    uint16 public feeBps = 150;                  // 1.5%

    /// @notice Sanity cap on what a collection may claim as royalty. ERC-2981 lets the NFT
    ///         contract name any figure, and this contract forwards it, so an unbounded
    ///         reading would let a compromised or mistaken collection take the whole sale.
    uint96 public constant MAX_ROYALTY_BPS = 2000; // 20%

    // ─── Bounds: adjustable, with fences ─────────────────────────────────────
    // Every figure is 18-decimal USDT. The dollar value is spelled out so a wrong exponent
    // is readable on inspection rather than buried in zeros.

    uint256 public minPriceUsdt = 1e18;             // $1
    uint256 public maxPriceUsdt = 1_000_000e18;     // $1,000,000

    /// Outer fences. Genuinely fixed: nothing legitimate lives outside them, and they stop
    /// a mistyped setter from reopening the hole this contract exists to avoid.
    uint256 public constant FLOOR_PRICE_USDT   = 0.01e18;         // $0.01 — never lower
    uint256 public constant CEILING_PRICE_USDT = 100_000_000e18;  // $100,000,000 — never higher

    uint256 public constant MIN_EXPIRY_SECONDS = 1 hours;
    uint256 public constant MAX_EXPIRY_SECONDS = 30 days;

    address public feeRecipient;
    bool public paused;

    IERC20  public immutable usdt;
    IERC721 public immutable nft;

    /// @notice Whether the collection answers ERC-2981. Read once at construction: a
    ///         collection cannot start or stop supporting an interface afterwards, and
    ///         probing on every trade would spend gas to learn a constant.
    bool public immutable royaltyAware;

    // ─── Orders ──────────────────────────────────────────────────────────────

    enum Status { PENDING, EXECUTED, CANCELLED, EXPIRED }

    /// A listing: the seller has escrowed the token and waits for a buyer.
    struct Order {
        uint256 id;
        address seller;
        uint256 tokenId;    // escrowed and held by this contract
        uint256 priceUsdt;  // total for the token
        uint64  createdAt;
        uint64  expiresAt;
        Status  status;
        address buyer;
        uint64  closedAt;
    }

    mapping(uint256 => Order) public orders;
    uint256 public nextOrderId;

    /// @notice Open listing id for a token, or 0 when there is none. Stops the same token
    ///         being listed twice and makes the open order findable from the token.
    ///
    /// @dev No +1 offset, and none is needed: ids come from `++nextOrderId`, so 0 is never
    ///      a real id. An earlier draft of this comment claimed an offset that the code
    ///      does not apply — `activeOrderForToken` returns this value raw, and callers
    ///      compare it to an order id directly.
    mapping(uint256 => uint256) private _openOrderOfToken;

    /// A standing bid: the buyer has escrowed the USDT and waits for someone to deliver.
    ///
    /// Kept in its own mapping rather than folded into `Order` behind a side flag. The sell
    /// path settles real money; entangling the two to save a little duplication would put
    /// every future change to one side inside the other's blast radius.
    struct BuyOrder {
        uint256 id;
        address buyer;
        uint256 tokenId;    // meaningful only when `anyToken` is false
        bool    anyToken;   // a bid for any token in the collection
        uint256 priceUsdt;  // escrowed here in full from the moment the bid is posted
        uint64  createdAt;
        uint64  expiresAt;
        Status  status;
        address seller;
        uint64  closedAt;
    }

    mapping(uint256 => BuyOrder) public buyOrders;
    uint256 public nextBuyOrderId;

    /// @notice USDT belonging to open bids. Anything above this is a stray transfer and is
    ///         the only USDT an admin may sweep — buyer escrow can never be reached.
    uint256 public totalEscrowedUsdt;

    /// @notice Tokens held against open listings, so the stray sweep cannot take one.
    uint256 public totalEscrowedTokens;

    event OrderCreated(uint256 indexed id, address indexed seller, uint256 indexed tokenId, uint256 priceUsdt, uint64 expiresAt);
    event OrderExecuted(uint256 indexed id, address indexed buyer, uint256 indexed tokenId, uint256 priceUsdt, uint256 royaltyAmount, uint256 feeAmount, uint256 sellerNet);
    event OrderCancelled(uint256 indexed id, address indexed by);
    event OrderExpired(uint256 indexed id, address indexed by);

    event BuyOrderCreated(uint256 indexed id, address indexed buyer, uint256 tokenId, bool anyToken, uint256 priceUsdt, uint64 expiresAt);
    event BuyOrderFilled(uint256 indexed id, address indexed seller, uint256 indexed tokenId, uint256 priceUsdt, uint256 royaltyAmount, uint256 feeAmount, uint256 sellerNet);
    event BuyOrderCancelled(uint256 indexed id, address indexed by);
    event BuyOrderExpired(uint256 indexed id, address indexed by);

    event FeeUpdated(uint16 oldBps, uint16 newBps);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event PausedSet(bool paused);
    event PriceBoundsUpdated(uint256 oldMin, uint256 oldMax, uint256 newMin, uint256 newMax);
    event StraySwept(address indexed token, address indexed to, uint256 amount);
    event StrayNftSwept(uint256 indexed tokenId, address indexed to);

    // ─────────────────────────────────────────────────────────────────────────

    constructor(address _usdt, address _nft, address _feeRecipient, address _admin) {
        require(_usdt != address(0) && _nft != address(0), "P2PN: zero token");
        require(_feeRecipient != address(0), "P2PN: zero recipient");
        require(_admin != address(0), "P2PN: zero admin");

        // The guard the last seven incidents needed and did not have.
        require(IERC20Metadata(_usdt).decimals() == 18, "P2PN: USDT must be 18 decimals");

        // A collection that is not ERC-721 would fail later, inside a transfer, with the
        // seller's token already gone. Refuse at construction instead.
        require(IERC165(_nft).supportsInterface(IID_ERC721), "P2PN: not an ERC-721");

        usdt = IERC20(_usdt);
        nft  = IERC721(_nft);

        // `supportsInterface` is itself optional in practice — a collection may not
        // implement ERC-165 correctly — so this tolerates a revert and reads it as "no".
        bool ok;
        try IERC165(_nft).supportsInterface(IID_ERC2981) returns (bool v) { ok = v; } catch { ok = false; }
        royaltyAware = ok;

        feeRecipient = _feeRecipient;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    modifier notPaused() {
        require(!paused, "P2PN: paused");
        _;
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function getOrder(uint256 id) external view returns (Order memory) { return orders[id]; }
    function getBuyOrder(uint256 id) external view returns (BuyOrder memory) { return buyOrders[id]; }

    /// @notice Open listing for a token, or 0 if there is none.
    function activeOrderForToken(uint256 tokenId) external view returns (uint256) {
        return _openOrderOfToken[tokenId];
    }

    function isExpired(uint256 id) external view returns (bool) {
        Order storage o = orders[id];
        return o.status == Status.PENDING && block.timestamp >= o.expiresAt;
    }

    /// @notice What a sale pays out, before anyone signs. Quoted so that neither side
    ///         learns the royalty or the fee from the receipt.
    function quote(uint256 id)
        external
        view
        returns (uint256 buyerPays, uint256 royaltyAmount, uint256 feeAmount, uint256 sellerReceives)
    {
        Order storage o = orders[id];
        return _split(o.tokenId, o.priceUsdt);
    }

    /// @notice What filling a bid pays the seller, before they sign.
    function quoteBuyOrder(uint256 id)
        external
        view
        returns (uint256 buyerPays, uint256 royaltyAmount, uint256 feeAmount, uint256 sellerReceives)
    {
        BuyOrder storage o = buyOrders[id];
        return _split(o.tokenId, o.priceUsdt);
    }

    /// @dev Royalty first, then platform fee, then whatever is left to the seller.
    ///      Reading the royalty is wrapped in `try` even behind `royaltyAware`: a
    ///      collection that answers the interface probe can still revert on the call, and
    ///      a trade must not become impossible because of a fault in someone else's
    ///      contract. A collection that cannot state a royalty is paid none.
    function _split(uint256 tokenId, uint256 priceUsdt)
        private
        view
        returns (uint256 buyerPays, uint256 royaltyAmount, uint256 feeAmount, uint256 sellerReceives)
    {
        buyerPays = priceUsdt;

        address receiver;
        if (royaltyAware) {
            try IERC2981(address(nft)).royaltyInfo(tokenId, priceUsdt) returns (address r, uint256 amt) {
                receiver = r;
                royaltyAmount = amt;
            } catch {
                receiver = address(0);
                royaltyAmount = 0;
            }
        }
        if (receiver == address(0)) royaltyAmount = 0;

        uint256 cap = (priceUsdt * MAX_ROYALTY_BPS) / 10_000;
        if (royaltyAmount > cap) royaltyAmount = cap;

        feeAmount = (priceUsdt * feeBps) / 10_000;
        sellerReceives = priceUsdt - royaltyAmount - feeAmount;
    }

    function _royaltyReceiver(uint256 tokenId, uint256 priceUsdt) private view returns (address) {
        if (!royaltyAware) return address(0);
        try IERC2981(address(nft)).royaltyInfo(tokenId, priceUsdt) returns (address r, uint256) {
            return r;
        } catch {
            return address(0);
        }
    }

    // ─── Seller ──────────────────────────────────────────────────────────────

    /// @notice Escrow `tokenId` and offer it for `priceUsdt`.
    /// @dev The token moves here immediately. A seller cannot promise a token they have
    ///      already sold, and a buyer is never asked to trust that they still hold it.
    function createOrder(uint256 tokenId, uint256 priceUsdt, uint64 expirySeconds)
        external
        nonReentrant
        notPaused
        returns (uint256 id)
    {
        require(priceUsdt >= minPriceUsdt && priceUsdt <= maxPriceUsdt, "P2PN: price out of range");
        require(
            expirySeconds >= MIN_EXPIRY_SECONDS && expirySeconds <= MAX_EXPIRY_SECONDS,
            "P2PN: expiry out of range"
        );
        require(_openOrderOfToken[tokenId] == 0, "P2PN: token already listed");

        // Pulls, rather than expecting a prior `safeTransferFrom` into this contract. An
        // NFT pushed in with no order attached is a stray, not a listing.
        nft.safeTransferFrom(msg.sender, address(this), tokenId);
        require(nft.ownerOf(tokenId) == address(this), "P2PN: NFT not received");

        id = ++nextOrderId;
        orders[id] = Order({
            id: id,
            seller: msg.sender,
            tokenId: tokenId,
            priceUsdt: priceUsdt,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + expirySeconds),
            status: Status.PENDING,
            buyer: address(0),
            closedAt: 0
        });
        _openOrderOfToken[tokenId] = id;
        totalEscrowedTokens += 1;

        emit OrderCreated(id, msg.sender, tokenId, priceUsdt, orders[id].expiresAt);
    }

    /// @notice Seller withdraws an unsold listing and takes the token back.
    /// @dev No cancellation fee. Withdrawing an offer nobody accepted is not a wrong, and
    ///      charging for it would only punish sellers who reprice honestly. The contract
    ///      being replaced charged one.
    function cancelOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        require(o.status == Status.PENDING, "P2PN: not open");
        require(o.seller == msg.sender, "P2PN: not seller");
        _closeOrder(o, Status.CANCELLED);
        nft.safeTransferFrom(address(this), o.seller, o.tokenId);
        emit OrderCancelled(id, msg.sender);
    }

    /// @notice Return an expired listing's token to its seller. Callable by anyone.
    /// @dev Permissionless on purpose: the token goes to the seller no matter who calls,
    ///      so there is nothing to gain by calling, and a seller is never locked out
    ///      because a keeper was down.
    function expireOrder(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        require(o.status == Status.PENDING, "P2PN: not open");
        require(block.timestamp >= o.expiresAt, "P2PN: not yet expired");
        _closeOrder(o, Status.EXPIRED);
        nft.safeTransferFrom(address(this), o.seller, o.tokenId);
        emit OrderExpired(id, msg.sender);
    }

    function _closeOrder(Order storage o, Status s) private {
        o.status = s;
        o.closedAt = uint64(block.timestamp);
        delete _openOrderOfToken[o.tokenId];
        totalEscrowedTokens -= 1;
    }

    // ─── Buyer takes a listing ───────────────────────────────────────────────

    /// @notice Pay the asking price and take the token. Both legs settle here or neither does.
    /// @param id           the listing being filled
    /// @param maxPriceAccepted the most the buyer will pay
    /// @dev `maxPriceAccepted` is not ceremony. A seller cannot reprice a live order today, but
    ///      a buyer signing against a stale screen deserves to fail rather than overpay, and
    ///      it keeps that guarantee if repricing is ever added.
    function matchOrder(uint256 id, uint256 maxPriceAccepted) external nonReentrant notPaused {
        Order storage o = orders[id];
        require(o.status == Status.PENDING, "P2PN: not open");
        require(block.timestamp < o.expiresAt, "P2PN: expired");
        require(msg.sender != o.seller, "P2PN: self-trade");
        require(o.priceUsdt <= maxPriceAccepted, "P2PN: price moved");

        (, uint256 royaltyAmount, uint256 feeAmount, uint256 sellerNet) = _split(o.tokenId, o.priceUsdt);
        address royaltyTo = _royaltyReceiver(o.tokenId, o.priceUsdt);

        address seller = o.seller;
        uint256 tokenId = o.tokenId;
        uint256 price = o.priceUsdt;

        o.buyer = msg.sender;
        _closeOrder(o, Status.EXECUTED);

        // USDT straight through from the buyer, never pooled here, so a stuck balance
        // cannot strand anyone's proceeds.
        usdt.safeTransferFrom(msg.sender, seller, sellerNet);
        if (royaltyAmount > 0 && royaltyTo != address(0)) {
            usdt.safeTransferFrom(msg.sender, royaltyTo, royaltyAmount);
        }
        if (feeAmount > 0) {
            usdt.safeTransferFrom(msg.sender, feeRecipient, feeAmount);
        }

        nft.safeTransferFrom(address(this), msg.sender, tokenId);

        emit OrderExecuted(id, msg.sender, tokenId, price, royaltyAmount, feeAmount, sellerNet);
    }

    // ─── Buyer posts a bid ───────────────────────────────────────────────────

    /// @notice Escrow `priceUsdt` and offer it for a token.
    /// @param tokenId  the token wanted; ignored when `anyToken` is true
    /// @param anyToken true to bid for any token in the collection
    /// @dev The USDT moves here immediately, for the same reason the sell side escrows the
    ///      token: a seller should not have to trust that a bidder is still good for it.
    ///
    ///      The contract being replaced had no bid side at all, so a buyer could only wait
    ///      for someone else to list.
    function createBuyOrder(uint256 tokenId, bool anyToken, uint256 priceUsdt, uint64 expirySeconds)
        external
        nonReentrant
        notPaused
        returns (uint256 id)
    {
        require(priceUsdt >= minPriceUsdt && priceUsdt <= maxPriceUsdt, "P2PN: price out of range");
        require(
            expirySeconds >= MIN_EXPIRY_SECONDS && expirySeconds <= MAX_EXPIRY_SECONDS,
            "P2PN: expiry out of range"
        );

        // Measure what arrived. A fee-on-transfer USDT would otherwise leave the bid
        // promising more than the contract holds, and the seller would find it short.
        uint256 before = usdt.balanceOf(address(this));
        usdt.safeTransferFrom(msg.sender, address(this), priceUsdt);
        require(usdt.balanceOf(address(this)) - before == priceUsdt, "P2PN: USDT transfer shortfall");

        id = ++nextBuyOrderId;
        buyOrders[id] = BuyOrder({
            id: id,
            buyer: msg.sender,
            tokenId: anyToken ? 0 : tokenId,
            anyToken: anyToken,
            priceUsdt: priceUsdt,
            createdAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + expirySeconds),
            status: Status.PENDING,
            seller: address(0),
            closedAt: 0
        });
        totalEscrowedUsdt += priceUsdt;

        emit BuyOrderCreated(id, msg.sender, anyToken ? 0 : tokenId, anyToken, priceUsdt, buyOrders[id].expiresAt);
    }

    /// @notice Deliver a token a bid asks for and take the escrowed USDT.
    /// @param id           the bid being filled
    /// @param tokenId      the token being delivered
    /// @param minPriceAccepted the least the seller will accept
    /// @dev The mirror of `matchOrder`'s cap: a seller signing against a stale screen fails
    ///      rather than parting with a token for less than they meant to.
    function fillBuyOrder(uint256 id, uint256 tokenId, uint256 minPriceAccepted)
        external
        nonReentrant
        notPaused
    {
        BuyOrder storage o = buyOrders[id];
        require(o.status == Status.PENDING, "P2PN: not open");
        require(block.timestamp < o.expiresAt, "P2PN: expired");
        require(msg.sender != o.buyer, "P2PN: self-trade");
        require(o.priceUsdt >= minPriceAccepted, "P2PN: price moved");
        require(o.anyToken || o.tokenId == tokenId, "P2PN: wrong token");
        // A token sitting in escrow against a listing is not the seller's to deliver.
        require(_openOrderOfToken[tokenId] == 0, "P2PN: token is listed");

        (, uint256 royaltyAmount, uint256 feeAmount, uint256 sellerNet) = _split(tokenId, o.priceUsdt);
        address royaltyTo = _royaltyReceiver(tokenId, o.priceUsdt);

        address buyer = o.buyer;
        uint256 price = o.priceUsdt;

        o.status = Status.EXECUTED;
        o.seller = msg.sender;
        o.closedAt = uint64(block.timestamp);
        totalEscrowedUsdt -= price;

        // Token straight from the seller to the buyer; the contract never holds it here.
        nft.safeTransferFrom(msg.sender, buyer, tokenId);

        usdt.safeTransfer(msg.sender, sellerNet);
        if (royaltyAmount > 0 && royaltyTo != address(0)) {
            usdt.safeTransfer(royaltyTo, royaltyAmount);
        }
        if (feeAmount > 0) {
            usdt.safeTransfer(feeRecipient, feeAmount);
        }

        emit BuyOrderFilled(id, msg.sender, tokenId, price, royaltyAmount, feeAmount, sellerNet);
    }

    /// @notice Buyer withdraws an unfilled bid and takes the USDT back.
    function cancelBuyOrder(uint256 id) external nonReentrant {
        BuyOrder storage o = buyOrders[id];
        require(o.status == Status.PENDING, "P2PN: not open");
        require(o.buyer == msg.sender, "P2PN: not buyer");
        o.status = Status.CANCELLED;
        o.closedAt = uint64(block.timestamp);
        totalEscrowedUsdt -= o.priceUsdt;
        usdt.safeTransfer(o.buyer, o.priceUsdt);
        emit BuyOrderCancelled(id, msg.sender);
    }

    /// @notice Return an expired bid's USDT to its buyer. Permissionless, for the same
    ///         reason `expireOrder` is: the money goes to the buyer no matter who calls.
    function expireBuyOrder(uint256 id) external nonReentrant {
        BuyOrder storage o = buyOrders[id];
        require(o.status == Status.PENDING, "P2PN: not open");
        require(block.timestamp >= o.expiresAt, "P2PN: not yet expired");
        o.status = Status.EXPIRED;
        o.closedAt = uint64(block.timestamp);
        totalEscrowedUsdt -= o.priceUsdt;
        usdt.safeTransfer(o.buyer, o.priceUsdt);
        emit BuyOrderExpired(id, msg.sender);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setFee(uint16 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newBps >= MIN_FEE_BPS && newBps <= MAX_FEE_BPS, "P2PN: fee out of range");
        emit FeeUpdated(feeBps, newBps);
        feeBps = newBps;
    }

    /// @notice Move the accepted price range. Stated in 18-decimal USDT: $250 is `250e18`.
    /// @dev This setter is the whole reason for the redeploy. The predecessor wrote its
    ///      bounds as `constant` and shipped a $0.000001 ceiling that no call could reach.
    function setPriceBounds(uint256 newMin, uint256 newMax) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMin >= FLOOR_PRICE_USDT, "P2PN: min below floor");
        require(newMax <= CEILING_PRICE_USDT, "P2PN: max above ceiling");
        require(newMin < newMax, "P2PN: min must be below max");
        emit PriceBoundsUpdated(minPriceUsdt, maxPriceUsdt, newMin, newMax);
        minPriceUsdt = newMin;
        maxPriceUsdt = newMax;
    }

    function setFeeRecipient(address newRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRecipient != address(0), "P2PN: zero recipient");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    /// @notice Stop new orders, new bids and new fills. Cancel and expire stay open by
    ///         design — a pause must never trap a seller's token or a buyer's money.
    function setPaused(bool p) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Sweep ERC-20 sent here by mistake.
    /// @dev Only ever the surplus above what open bids have escrowed, so no admin,
    ///      compromised or otherwise, can reach money that belongs to a member.
    function sweepStray(address token, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(to != address(0), "P2PN: zero to");
        if (token == address(usdt)) {
            uint256 balance = usdt.balanceOf(address(this));
            require(balance > totalEscrowedUsdt, "P2PN: no stray USDT");
            require(amount <= balance - totalEscrowedUsdt, "P2PN: would touch escrow");
        }
        IERC20(token).safeTransfer(to, amount);
        emit StraySwept(token, to, amount);
    }

    /// @notice Return an NFT that was pushed in without an order attached.
    /// @dev Refuses any token backing a live listing, so a seller's escrow is unreachable.
    ///      This exists because a contract that can hold a token must be able to send it —
    ///      `TreasuryManager v1` could not, and 105,000,000 MIC is stranded there forever.
    function sweepStrayNft(uint256 tokenId, address to)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(to != address(0), "P2PN: zero to");
        require(_openOrderOfToken[tokenId] == 0, "P2PN: token is escrowed");
        require(nft.ownerOf(tokenId) == address(this), "P2PN: not held");
        nft.safeTransferFrom(address(this), to, tokenId);
        emit StrayNftSwept(tokenId, to);
    }

    /// @dev Accepts incoming tokens so `safeTransferFrom` into this contract works.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}
