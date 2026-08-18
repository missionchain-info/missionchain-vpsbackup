// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICommunityNFTV2 {
    function ownerOf(uint256 tokenId) external view returns (address);
    function tierOf(uint256 tokenId) external view returns (uint256);
    function expiresAt(uint256 tokenId) external view returns (uint256);
    function tierMultiplier(uint256 tier) external view returns (uint256);
    function totalSerials() external view returns (uint256);
}

/**
 * @title NftRewardPoolV2
 * @notice Holds an NFT programme's share of daily emission and lets holders claim it.
 *
 * ## Why this replaces the push-based pool
 *
 * The first pool paid out through `distribute(recipients[], amounts[])` — an operator
 * pushing MIC to a list of wallets. That has no claim button behind it, because there is
 * nothing for a holder to call; it also makes the platform pay gas per recipient, caps a
 * payout at whatever fits in one transaction, and stops entirely on any day nobody
 * remembers to run it.
 *
 * Here the MIC arrives on its own and sits until its owner comes for it. A holder's
 * entitlement is derived from a running total rather than allocated to them, so nobody
 * has to be enumerated, no batch has a size limit, and claiming a month late pays exactly
 * what claiming hourly would have.
 *
 * ## Weight
 *
 * A Community NFT's weight is its tier multiplier — Builder ×1, Maker ×2.5, Luminary ×5 —
 * read from the NFT contract rather than copied here, so a DAO vote that changes a
 * multiplier changes this pool with it. MFP passes carry a fixed weight and never expire.
 *
 * ## Expiry is exact
 *
 * Community NFTs expire, and their durations differ (60 / 90 / 180 days), so they do not
 * expire in the order they were minted — a FIFO queue would mis-order them. Expiries are
 * kept in a min-heap keyed on expiry time, and `_sync` advances the accumulator to each
 * expiry moment before removing that weight. The seconds either side of an expiry are
 * therefore priced against different divisors, which is the whole point: an expired NFT
 * must not take a share from the ones still running.
 *
 * ## The pool cannot see transfers
 *
 * `CommunityNFTv2` is a plain ERC-721 with no hook into this contract, so a sale is
 * invisible here until somebody says so. `resync(tokenId)` is permissionless and does
 * exactly that: it settles what the old holder earned while they held it and moves the
 * weight to the current owner. Until it is called the reward keeps accruing to the seller
 * — which is why the keeper resyncs on every transfer it sees, and why the buyer can
 * always force it themselves.
 */
contract NftRewardPoolV2 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Held by EmissionController. Announces newly minted MIC.
    bytes32 public constant EMISSION_ROLE = keccak256("EMISSION_ROLE");

    /// @notice Window a notified reward is streamed over.
    uint256 public constant REWARD_PERIOD = 1 days;

    /// @notice Expiries retired per sync, bounding what one caller pays for a backlog.
    uint256 public constant MAX_EXPIRIES_PER_SYNC = 50;

    uint256 private constant PRECISION = 1e18;

    IERC20 public immutable micToken;

    /// @notice The NFT collection this pool rewards. Zero for a pool driven purely by
    ///         `setWeight` (used for MFP, whose passes never expire).
    ICommunityNFTV2 public nft;

    /// @notice Weight of one MFP pass, when this pool is configured for MFP.
    uint256 public flatWeight;

    // ── Streaming ────────────────────────────────────────────────────────────
    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastSync;
    uint256 public accPerWeight;
    uint256 public carryOver;

    // ── Holders ──────────────────────────────────────────────────────────────
    uint256 public totalWeight;
    mapping(address => uint256) public weightOf;
    mapping(address => uint256) public rewardDebt;
    mapping(address => uint256) public accrued;

    /// @notice Weight a token currently contributes, and to whom.
    mapping(uint256 => uint256) public tokenWeight;
    mapping(uint256 => address) public tokenHolder;

    // ── Expiry heap ──────────────────────────────────────────────────────────
    struct Expiry { uint64 at; uint256 tokenId; }
    Expiry[] private _heap;

    uint256 public totalNotified;
    uint256 public totalClaimed;

    event RewardNotified(uint256 amount, uint256 rate, uint256 periodFinish);
    event Enrolled(uint256 indexed tokenId, address indexed holder, uint256 weight, uint256 expiresAt);
    event Expired(uint256 indexed tokenId, address indexed holder, uint256 weight);
    event Resynced(uint256 indexed tokenId, address indexed from, address indexed to);
    event Claimed(address indexed account, uint256 amount);
    event CarriedOver(uint256 amount);

    constructor(address _micToken, address _nft, uint256 _flatWeight, address admin) {
        require(_micToken != address(0) && admin != address(0), "NRP: zero address");
        require(_nft != address(0) || _flatWeight > 0, "NRP: needs an nft or a flat weight");
        micToken = IERC20(_micToken);
        nft = ICommunityNFTV2(_nft);
        flatWeight = _flatWeight;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        lastSync = block.timestamp;
    }

    // ─────────────────────────────────────────────────────────
    // Accounting core
    // ─────────────────────────────────────────────────────────

    function _accrueTo(uint256 ts) private {
        if (ts <= lastSync) return;

        uint256 until_ = ts < periodFinish ? ts : periodFinish;
        if (until_ > lastSync) {
            uint256 elapsed = until_ - lastSync;
            if (totalWeight == 0) {
                uint256 undistributed = elapsed * rewardRate;
                if (undistributed > 0) {
                    carryOver += undistributed;
                    emit CarriedOver(undistributed);
                }
            } else {
                accPerWeight += (elapsed * rewardRate * PRECISION) / totalWeight;
            }
        }
        lastSync = ts;
    }

    /// @dev Move what a holder has earned into their settled balance. Called before any
    ///      change to their weight, so the change never re-prices time already elapsed.
    function _settle(address who) private {
        uint256 w = weightOf[who];
        if (w > 0) {
            uint256 earned = (w * (accPerWeight - rewardDebt[who])) / PRECISION;
            if (earned > 0) accrued[who] += earned;
        }
        rewardDebt[who] = accPerWeight;
    }

    function _sync() internal {
        uint256 nowTs = block.timestamp;
        uint256 processed = 0;

        while (_heap.length > 0 && processed < MAX_EXPIRIES_PER_SYNC) {
            Expiry memory top = _heap[0];
            if (uint256(top.at) > nowTs) break;

            _accrueTo(uint256(top.at));
            _popRoot();
            _retire(top.tokenId);

            processed += 1;
        }

        // A backlog left unprocessed stops the clock here. Accruing to now over a divisor
        // that still counts expired NFTs would overpay everyone still holding.
        bool backlog = _heap.length > 0 && uint256(_heap[0].at) <= nowTs;
        if (!backlog) _accrueTo(nowTs);
    }

    function _retire(uint256 tokenId) private {
        uint256 w = tokenWeight[tokenId];
        if (w == 0) return;
        address who = tokenHolder[tokenId];

        _settle(who);
        weightOf[who] -= w;
        totalWeight -= w;
        tokenWeight[tokenId] = 0;
        tokenHolder[tokenId] = address(0);

        emit Expired(tokenId, who, w);
    }

    /// @notice Bring the pool up to date and retire expired NFTs. Permissionless.
    function sync() external { _sync(); }

    /// @notice Expiries that have fallen due and not yet been recorded.
    function pendingExpiries() external view returns (uint256 count) {
        for (uint256 i = 0; i < _heap.length; i++) {
            if (uint256(_heap[i].at) <= block.timestamp) count += 1;
        }
    }

    function heapSize() external view returns (uint256) { return _heap.length; }

    // ─────────────────────────────────────────────────────────
    // Min-heap on expiry time
    // ─────────────────────────────────────────────────────────
    //
    // Community NFTs run 60, 90 or 180 days, so they do not expire in the order they were
    // minted and a queue would retire the wrong one. A heap keeps the earliest expiry at
    // the root for O(log n) insert and removal.

    /// @dev Swap through a memory temporary rather than a tuple assignment.
    ///      `(a[i], a[j]) = (a[j], a[i])` on storage copies in sequence with no temporary,
    ///      so the first write can clobber the value the second still needs — solc warns
    ///      about exactly this, and a heap that silently duplicates an element would
    ///      retire the wrong NFT.
    function _swap(uint256 a, uint256 b) private {
        Expiry memory tmp = _heap[a];
        _heap[a] = _heap[b];
        _heap[b] = tmp;
    }

    function _push(uint64 at, uint256 tokenId) private {
        _heap.push(Expiry({ at: at, tokenId: tokenId }));
        uint256 i = _heap.length - 1;
        while (i > 0) {
            uint256 parent = (i - 1) / 2;
            if (_heap[parent].at <= _heap[i].at) break;
            _swap(parent, i);
            i = parent;
        }
    }

    function _popRoot() private {
        uint256 n = _heap.length;
        _heap[0] = _heap[n - 1];
        _heap.pop();
        n -= 1;

        uint256 i = 0;
        while (true) {
            uint256 l = 2 * i + 1;
            uint256 r = l + 1;
            uint256 smallest = i;
            if (l < n && _heap[l].at < _heap[smallest].at) smallest = l;
            if (r < n && _heap[r].at < _heap[smallest].at) smallest = r;
            if (smallest == i) break;
            _swap(smallest, i);
            i = smallest;
        }
    }

    // ─────────────────────────────────────────────────────────
    // Enrolment
    // ─────────────────────────────────────────────────────────

    /// @notice Start a Community NFT earning. Permissionless — anyone may enrol anyone's
    ///         token, because doing so only ever credits the token's actual owner.
    ///
    /// @dev Earning starts now, not at mint. A token minted while the pool was empty
    ///      cannot reach back and claim a share of rewards that were already carried over
    ///      to other holders.
    function enroll(uint256 tokenId) public {
        require(address(nft) != address(0), "NRP: not an NFT pool");
        require(tokenWeight[tokenId] == 0, "NRP: already enrolled");

        uint256 expiry = nft.expiresAt(tokenId);
        require(expiry > block.timestamp, "NRP: already expired");

        address owner_ = nft.ownerOf(tokenId);
        uint256 w = nft.tierMultiplier(nft.tierOf(tokenId));
        require(w > 0, "NRP: zero weight");

        _sync();
        _settle(owner_);

        tokenWeight[tokenId] = w;
        tokenHolder[tokenId] = owner_;
        weightOf[owner_] += w;
        totalWeight += w;
        _push(uint64(expiry), tokenId);

        emit Enrolled(tokenId, owner_, w, expiry);
    }

    function enrollBatch(uint256[] calldata tokenIds) external {
        for (uint256 i = 0; i < tokenIds.length; i++) enroll(tokenIds[i]);
    }

    /// @notice Move an enrolled token's weight to its current owner, settling the previous
    ///         one. Permissionless, because the buyer needs to be able to force it.
    ///
    /// @dev The pool has no way to observe an ERC-721 transfer, so until this is called a
    ///      sold NFT keeps earning for the seller. That is the honest default — it credits
    ///      whoever the pool last knew held it — but it is why the keeper calls this on
    ///      every Transfer it sees.
    function resync(uint256 tokenId) public {
        uint256 w = tokenWeight[tokenId];
        require(w > 0, "NRP: not enrolled");

        address from = tokenHolder[tokenId];
        address to = nft.ownerOf(tokenId);
        if (from == to) return;

        _sync();
        _settle(from);
        _settle(to);

        weightOf[from] -= w;
        weightOf[to] += w;
        tokenHolder[tokenId] = to;

        emit Resynced(tokenId, from, to);
    }

    function resyncBatch(uint256[] calldata tokenIds) external {
        for (uint256 i = 0; i < tokenIds.length; i++) resync(tokenIds[i]);
    }

    /// @notice Set a wallet's weight directly. Used by the MFP pool, whose passes never
    ///         expire and so need no heap — the keeper reports each holder's count.
    function setWeight(address who, uint256 passes) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(address(nft) == address(0), "NRP: NFT pool uses enroll()");
        require(who != address(0), "NRP: zero holder");

        _sync();
        _settle(who);

        uint256 old = weightOf[who];
        uint256 next = passes * flatWeight;
        weightOf[who] = next;
        totalWeight = totalWeight - old + next;
    }

    // ─────────────────────────────────────────────────────────
    // Inbound
    // ─────────────────────────────────────────────────────────

    /// @notice Announce MIC already minted here, to be streamed over 24 hours.
    function notifyReward(uint256 amount) external onlyRole(EMISSION_ROLE) {
        _sync();

        uint256 leftover = 0;
        if (block.timestamp < periodFinish) {
            leftover = (periodFinish - block.timestamp) * rewardRate;
        }

        uint256 owed = totalNotified - totalClaimed;
        require(micToken.balanceOf(address(this)) >= owed + amount, "NRP: reward not funded");

        uint256 total = amount + leftover + carryOver;
        carryOver = 0;

        rewardRate = total / REWARD_PERIOD;
        periodFinish = block.timestamp + REWARD_PERIOD;
        lastSync = block.timestamp;
        totalNotified += amount;

        emit RewardNotified(amount, rewardRate, periodFinish);
    }

    // ─────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────

    function _projectedAcc() private view returns (uint256 acc) {
        acc = accPerWeight;
        uint256 weight = totalWeight;
        uint256 from = lastSync;
        uint256 nowTs = block.timestamp;

        // Only the earliest expiry is cheap to see from a view; beyond that the heap would
        // have to be sorted in memory. One step is enough to keep `pending` honest for the
        // common case of a single overdue expiry, and `sync()` settles the rest exactly.
        if (_heap.length > 0 && uint256(_heap[0].at) <= nowTs) {
            uint256 at = uint256(_heap[0].at);
            uint256 until_ = at < periodFinish ? at : periodFinish;
            if (until_ > from && weight > 0) {
                acc += ((until_ - from) * rewardRate * PRECISION) / weight;
            }
            return acc;
        }

        uint256 cap = nowTs < periodFinish ? nowTs : periodFinish;
        if (cap > from && weight > 0) {
            acc += ((cap - from) * rewardRate * PRECISION) / weight;
        }
    }

    /// @notice MIC `account` can claim right now — settled plus still accruing.
    function claimable(address account) public view returns (uint256) {
        uint256 w = weightOf[account];
        uint256 pending = w == 0
            ? 0
            : (w * (_projectedAcc() - rewardDebt[account])) / PRECISION;
        return accrued[account] + pending;
    }

    /// @notice Current reward rate expressed per day, for display.
    function rewardPerDay() external view returns (uint256) {
        return block.timestamp >= periodFinish ? 0 : rewardRate * 1 days;
    }

    // ─────────────────────────────────────────────────────────
    // Claim
    // ─────────────────────────────────────────────────────────

    /// @notice Send everything owed to the caller.
    function claim() external nonReentrant {
        _sync();
        _settle(msg.sender);

        uint256 amount = accrued[msg.sender];
        require(amount > 0, "NRP: nothing to claim");
        accrued[msg.sender] = 0;
        totalClaimed += amount;

        micToken.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ─────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────

    function setNft(address _nft) external onlyRole(DEFAULT_ADMIN_ROLE) {
        nft = ICommunityNFTV2(_nft);
    }

    /// @notice Recover a token sent here by mistake. MIC is refused — everything held here
    ///         is owed to holders, and the only way out is a claim.
    function rescueToken(address token, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(token != address(micToken), "NRP: MIC belongs to holders");
        require(to != address(0), "NRP: zero recipient");
        IERC20(token).safeTransfer(to, amount);
    }
}
