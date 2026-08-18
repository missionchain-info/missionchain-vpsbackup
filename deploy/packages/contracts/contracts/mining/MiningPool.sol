// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MiningPool
 * @notice Holds the 59% miner share of daily emission and pays it out per MICE licence.
 *
 * ## Why this is not an epoch pool
 *
 * The first design snapshotted a reward per epoch and had miners claim out of the
 * contract's balance. It only worked under an operating rule — settle epoch N before
 * funding epoch N+1 — which is unenforceable once `EmissionController` mints here every
 * day on its own schedule while claiming stays pull-based. One pot would be promised to
 * two epochs, and a miner who simply claimed late would lose their reward to a faster one.
 *
 * This contract has no pot to miscount. Each licence carries its own bookmark
 * (`rewardDebt`) into a running total (`accPerLicence`), so what a licence is owed is
 * derived, never allocated. Two licences cannot be owed the same MIC, and claiming late
 * costs nothing.
 *
 * ## Rewards accrue by the second
 *
 * `notifyReward` spreads an amount evenly across `REWARD_PERIOD` (one day) rather than
 * crediting it all at once. That is what makes "you were activated at 3pm, so you earn
 * from 3pm" true: a licence active for nine hours earns nine hours' worth, not a whole
 * day's, and nobody is diluted by a licence that showed up at the last minute.
 *
 * ## Expiry is exact, not swept
 *
 * A licence stops earning at its own `expiryTime`, to the second — not when somebody
 * gets around to recycling it. An earlier draft settled expiry on recycling and accepted
 * a bounded over-earn in between; that made a rule of the tokenomics depend on an
 * operator's diligence, which is precisely the class of assumption that broke the epoch
 * pool.
 *
 * Exactness is affordable here because expiries are already sorted. Every licence runs
 * the same 360 days and activation timestamps only ever increase, so licences expire in
 * the order they were activated — a plain FIFO queue, no sorting and no per-claim search.
 * `_sync` walks the queue, advancing the accumulator to each expiry moment before
 * removing that licence, so the seconds before and after an expiry are priced against
 * different divisors, exactly as they should be.
 *
 * If more licences expire at once than one transaction should process, accrual pauses at
 * the oldest unprocessed expiry rather than running past it. Nothing is lost — the time
 * is credited when the queue is drained — and the alternative, accruing over a stale
 * divisor, would silently overpay everyone still holding.
 *
 * ## When nothing is mining
 *
 * MIC that streams while no licence is active is not distributed and not lost: it lands
 * in `carryOver` and is folded into the next `notifyReward`.
 */
contract MiningPool is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Held by EmissionController. Announces newly minted MIC.
    bytes32 public constant EMISSION_ROLE = keccak256("EMISSION_ROLE");
    /// @notice Held by MICELicense. Reports activation, expiry and transfer.
    bytes32 public constant LICENCE_ROLE = keccak256("LICENCE_ROLE");

    /// @notice Window a notified reward is streamed over. Matches the daily emission
    ///         cadence, so a late keeper run stretches rather than spikes the payout.
    uint256 public constant REWARD_PERIOD = 1 days;

    /// @notice Expiries retired per `_sync`. Bounds the gas any single caller can be made
    ///         to pay for a backlog they did not create.
    uint256 public constant MAX_EXPIRIES_PER_SYNC = 100;

    uint256 private constant PRECISION = 1e18;

    IERC20 public immutable micToken;

    // ── Streaming state ──────────────────────────────────────────────────────
    uint256 public rewardRate;
    uint256 public periodFinish;
    uint256 public lastSync;
    uint256 public accPerLicence;
    uint256 public carryOver;

    // ── Licence state ────────────────────────────────────────────────────────
    uint256 public totalActive;
    mapping(uint256 => uint256) public rewardDebt;
    mapping(uint256 => bool) public isActive;
    /// @notice Who a live licence earns for. Maintained here so retiring a licence never
    ///         has to call out to MICELicense mid-loop; `claim` still treats MICELicense
    ///         as the authority on ownership.
    mapping(uint256 => address) public holder;
    /// @notice Settled but unclaimed MIC per wallet. Rewards bank here on expiry or sale,
    ///         so they follow the person who earned them rather than the licence.
    mapping(address => uint256) public accrued;

    // ── Expiry queue ─────────────────────────────────────────────────────────
    struct Expiry { uint256 licenceId; uint256 at; }
    Expiry[] private _queue;
    uint256 private _head;

    uint256 public totalNotified;
    uint256 public totalClaimed;

    event RewardNotified(uint256 amount, uint256 rate, uint256 periodFinish);
    event LicenceActivated(uint256 indexed licenceId, address indexed owner, uint256 expiryTime);
    event LicenceExpired(uint256 indexed licenceId, address indexed owner, uint256 settled, uint256 at);
    event LicenceTransferred(uint256 indexed licenceId, address indexed from, address indexed to, uint256 settled);
    event Claimed(address indexed account, uint256 amount);
    event CarriedOver(uint256 amount);

    constructor(address _micToken, address admin) {
        require(_micToken != address(0) && admin != address(0), "MP: zero address");
        micToken = IERC20(_micToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        lastSync = block.timestamp;
    }

    // ─────────────────────────────────────────────────────────
    // Accounting core
    // ─────────────────────────────────────────────────────────

    /// @dev Advance the accumulator to `ts`. Only time inside the streaming window earns;
    ///      `lastSync` still moves to `ts` so the dry stretch is never replayed.
    function _accrueTo(uint256 ts) private {
        if (ts <= lastSync) return;

        uint256 until_ = ts < periodFinish ? ts : periodFinish;
        if (until_ > lastSync) {
            uint256 elapsed = until_ - lastSync;
            if (totalActive == 0) {
                uint256 undistributed = elapsed * rewardRate;
                if (undistributed > 0) {
                    carryOver += undistributed;
                    emit CarriedOver(undistributed);
                }
            } else {
                accPerLicence += (elapsed * rewardRate * PRECISION) / totalActive;
            }
        }
        lastSync = ts;
    }

    /// @dev Settle a licence at the accumulator's current value and take it off the books.
    function _retire(uint256 licenceId, uint256 at) private {
        if (!isActive[licenceId]) return;
        address who = holder[licenceId];
        uint256 settled = (accPerLicence - rewardDebt[licenceId]) / PRECISION;

        isActive[licenceId] = false;
        totalActive -= 1;
        rewardDebt[licenceId] = 0;
        holder[licenceId] = address(0);
        if (settled > 0) accrued[who] += settled;

        emit LicenceExpired(licenceId, who, settled, at);
    }

    /// @dev Bring the accumulator to the present, retiring anything that expired on the
    ///      way. Must run before any change to `totalActive` or `rewardRate`.
    function _sync() internal {
        uint256 nowTs = block.timestamp;
        uint256 processed = 0;

        while (_head < _queue.length && processed < MAX_EXPIRIES_PER_SYNC) {
            Expiry storage e = _queue[_head];
            if (e.at > nowTs) break;
            // Price the seconds up to the expiry with this licence still counted, then
            // remove it — so the instant of expiry is the boundary, not an approximation.
            _accrueTo(e.at);
            _retire(e.licenceId, e.at);
            _head += 1;
            processed += 1;
        }

        // A backlog left unprocessed must stop the clock here. Accruing to `now` over a
        // divisor that still counts expired licences would overpay every live holder.
        bool backlog = _head < _queue.length && _queue[_head].at <= nowTs;
        if (!backlog) _accrueTo(nowTs);
    }

    /// @notice Bring the pool up to date and retire due licences. Permissionless: it
    ///         changes no entitlement, only when it is recorded.
    function sync() external { _sync(); }

    /// @notice Number of expiries waiting to be processed.
    function pendingExpiries() external view returns (uint256 count) {
        uint256 nowTs = block.timestamp;
        for (uint256 i = _head; i < _queue.length; i++) {
            if (_queue[i].at > nowTs) break;
            count += 1;
        }
    }

    // ─────────────────────────────────────────────────────────
    // Inbound — EmissionController
    // ─────────────────────────────────────────────────────────

    /// @notice Announce MIC already minted to this contract, to be streamed over 24 hours.
    ///
    /// @dev Anything unstreamed from the previous period is rolled in together with
    ///      `carryOver`, so a late keeper postpones rewards but never destroys them. The
    ///      contract's balance is the ceiling: notifying more than it holds would let the
    ///      accumulator promise MIC that does not exist, and the shortfall would surface
    ///      only later, as a failed claim for whoever came last.
    function notifyReward(uint256 amount) external onlyRole(EMISSION_ROLE) {
        _sync();

        uint256 leftover = 0;
        if (block.timestamp < periodFinish) {
            leftover = (periodFinish - block.timestamp) * rewardRate;
        }

        uint256 owed = totalNotified - totalClaimed;
        require(micToken.balanceOf(address(this)) >= owed + amount, "MP: reward not funded");

        uint256 total = amount + leftover + carryOver;
        carryOver = 0;

        rewardRate = total / REWARD_PERIOD;
        periodFinish = block.timestamp + REWARD_PERIOD;
        lastSync = block.timestamp;
        totalNotified += amount;

        emit RewardNotified(amount, rewardRate, periodFinish);
    }

    // ─────────────────────────────────────────────────────────
    // Inbound — MICELicense
    // ─────────────────────────────────────────────────────────

    /// @notice A licence began its term and starts earning from this second, until
    ///         `expiryTime` and not one second longer.
    ///
    /// @dev `expiryTime` must not precede the tail of the queue. Every licence runs the
    ///      same duration from activation and activation times only increase, so this
    ///      holds by construction — the check is here because the FIFO would silently
    ///      mis-order expiries if that ever stopped being true.
    function onLicenceActivated(uint256 licenceId, address owner_, uint256 expiryTime)
        external onlyRole(LICENCE_ROLE)
    {
        require(!isActive[licenceId], "MP: already active");
        require(expiryTime > block.timestamp, "MP: already expired");
        if (_queue.length > 0) {
            require(expiryTime >= _queue[_queue.length - 1].at, "MP: expiry out of order");
        }

        _sync();

        isActive[licenceId] = true;
        holder[licenceId] = owner_;
        totalActive += 1;
        rewardDebt[licenceId] = accPerLicence;
        _queue.push(Expiry({ licenceId: licenceId, at: expiryTime }));

        emit LicenceActivated(licenceId, owner_, expiryTime);
    }

    /// @notice Recycling reports the end of a licence. By the time this is called the
    ///         queue has almost always retired it already; this is the belt to that
    ///         braces, and is deliberately idempotent.
    function onLicenceEnded(uint256 licenceId, address) external onlyRole(LICENCE_ROLE) {
        _sync();
        if (!isActive[licenceId]) return;
        _retire(licenceId, block.timestamp);
    }

    /// @notice A licence changed hands. What it earned up to now belongs to the seller;
    ///         the buyer earns from this second. Expiry is unaffected — a sale does not
    ///         extend a term.
    function onLicenceTransferred(uint256 licenceId, address from, address to)
        external onlyRole(LICENCE_ROLE)
    {
        _sync();
        if (!isActive[licenceId]) return;   // never activated, or already expired

        uint256 settled = (accPerLicence - rewardDebt[licenceId]) / PRECISION;
        rewardDebt[licenceId] = accPerLicence;
        holder[licenceId] = to;
        if (settled > 0) accrued[from] += settled;

        emit LicenceTransferred(licenceId, from, to, settled);
    }

    // ─────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────

    /// @dev Replays `_sync` in memory so the views agree with what a transaction would
    ///      compute — including the expiries that have fallen due but not been recorded.
    function _projected() private view returns (uint256 acc, uint256 active, uint256 syncAt) {
        acc = accPerLicence;
        active = totalActive;
        syncAt = lastSync;

        uint256 nowTs = block.timestamp;
        uint256 i = _head;
        uint256 processed = 0;

        while (i < _queue.length && processed < MAX_EXPIRIES_PER_SYNC) {
            uint256 at = _queue[i].at;
            if (at > nowTs) break;
            (acc, syncAt) = _project(acc, active, syncAt, at);
            if (active > 0) active -= 1;
            i += 1;
            processed += 1;
        }

        bool backlog = i < _queue.length && _queue[i].at <= nowTs;
        if (!backlog) (acc, syncAt) = _project(acc, active, syncAt, nowTs);
    }

    function _project(uint256 acc, uint256 active, uint256 from, uint256 to)
        private view returns (uint256, uint256)
    {
        if (to <= from) return (acc, from);
        uint256 until_ = to < periodFinish ? to : periodFinish;
        if (until_ > from && active > 0) {
            acc += ((until_ - from) * rewardRate * PRECISION) / active;
        }
        return (acc, to);
    }

    /// @notice Accumulator as of now, expiries included.
    function currentAccPerLicence() public view returns (uint256 acc) {
        (acc, , ) = _projected();
    }

    /// @notice MIC a licence has earned and not yet had settled. Zero once expired —
    ///         what it earned before expiry moves to `accrued` for its holder.
    function pendingOf(uint256 licenceId) public view returns (uint256) {
        if (!isActive[licenceId]) return 0;

        // An expiry that has fallen due but not been recorded still ends the licence.
        for (uint256 i = _head; i < _queue.length; i++) {
            if (_queue[i].at > block.timestamp) break;
            if (_queue[i].licenceId == licenceId) return 0;
        }

        return (currentAccPerLicence() - rewardDebt[licenceId]) / PRECISION;
    }

    /// @notice Everything `account` could claim right now.
    function claimableOf(address account, uint256[] calldata licenceIds)
        external view returns (uint256 total)
    {
        total = accrued[account];
        for (uint256 i = 0; i < licenceIds.length; i++) {
            total += pendingOf(licenceIds[i]);
        }
    }

    // ─────────────────────────────────────────────────────────
    // Claim
    // ─────────────────────────────────────────────────────────

    /// @notice Settle the given licences and send everything owed to the caller.
    ///
    /// @dev Licences that have expired are simply skipped: `_sync` has already banked
    ///      their earnings into `accrued`, which this pays out in the same call. So a
    ///      holder never has to know whether a licence is still running to be paid.
    function claim(uint256[] calldata licenceIds) external nonReentrant {
        _sync();

        for (uint256 i = 0; i < licenceIds.length; i++) {
            uint256 id = licenceIds[i];
            if (!isActive[id]) continue;
            require(licenceOwner(id) == msg.sender, "MP: not licence owner");
            uint256 earned = (accPerLicence - rewardDebt[id]) / PRECISION;
            rewardDebt[id] = accPerLicence;
            if (earned > 0) accrued[msg.sender] += earned;
        }

        _payout();
    }

    /// @notice Claim what has already been banked — no licence list needed. Used by a
    ///         holder whose licences have expired or been sold on.
    function claimAccrued() external nonReentrant {
        _sync();
        _payout();
    }

    function _payout() private {
        uint256 amount = accrued[msg.sender];
        require(amount > 0, "MP: nothing to claim");
        accrued[msg.sender] = 0;
        totalClaimed += amount;
        micToken.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ─────────────────────────────────────────────────────────
    // Wiring
    // ─────────────────────────────────────────────────────────

    /// @notice MICELicense, consulted for ownership at claim time.
    address public licenceContract;

    function setLicenceContract(address c) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(c != address(0), "MP: zero licence contract");
        licenceContract = c;
    }

    /// @dev Ownership is read from MICELicense rather than trusted from `holder`, so a
    ///      drift between the two can never let the wrong wallet claim.
    function licenceOwner(uint256 licenceId) public view returns (address) {
        (bool ok, bytes memory data) = licenceContract.staticcall(
            abi.encodeWithSignature("ownerOfLicense(uint256)", licenceId)
        );
        require(ok && data.length >= 32, "MP: owner lookup failed");
        return abi.decode(data, (address));
    }

    /// @notice Recover a token sent here by mistake. MIC is refused: everything held here
    ///         is owed to miners, and the only way out is a claim.
    function rescueToken(address token, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(token != address(micToken), "MP: MIC belongs to miners");
        require(to != address(0), "MP: zero recipient");
        IERC20(token).safeTransfer(to, amount);
    }
}
