// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PeriodRewardPool
 * @notice The weekly and monthly USDT rewards, claimed by NFT holders.
 *
 * ## Why this is not the streaming pool
 *
 * The daily MIC pool pays by how long you held: every second of holding earns, and a
 * holder who arrives late earns proportionally less. These two programmes do not work
 * that way, and deliberately so.
 *
 *  · **Weekly** goes only to Community NFTs *minted during that week*. Holding one from a
 *    previous week earns nothing, however long it is kept. Eligibility is a fact about the
 *    week an NFT was born in, not about time held.
 *
 *  · **Monthly** goes to every Community NFT still valid at the cut-off — 24:00 GMT on the
 *    last day of the month. It is a photograph taken at one instant, not an average.
 *
 * Neither can be expressed as an accumulator, because in both cases the period defines who
 * qualifies. So each period is opened, funded, filled with its cohort, sealed, and then
 * left for holders to claim from. Nothing is ever pushed out.
 *
 * MFP passes carry no such restriction — they qualify for every period they exist in — but
 * they use the same machinery, in their own pool instance.
 *
 * ## The cohort is computed off chain
 *
 * Working out which NFTs were minted in a given week, or which were still valid at a
 * month's end, means walking the whole collection; doing that on chain would cost more
 * than it distributes. The operator computes it and writes it here in batches, and the
 * period is sealed before anyone can claim — so the numbers are fixed, public, and
 * checkable against the chain's own mint and expiry records before a single dollar moves.
 *
 * ## What sealing protects
 *
 * `finalize` is the line between "being prepared" and "owed to people". Before it, weights
 * can be corrected; after it, nothing about the period can change and the arithmetic is
 * frozen. Allowing a weight to move after a claim would silently re-price what everyone
 * else is owed, and the first person to notice would be whoever came last and found the
 * pool empty.
 */
contract PeriodRewardPool is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Opens periods, writes cohorts, seals them. Held by the reward operator.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice Sends USDT in. Held by RevenueRouter or the operator.
    bytes32 public constant FUNDER_ROLE = keccak256("FUNDER_ROLE");

    IERC20 public immutable rewardToken;

    /// @notice A holder cannot be left unable to claim, so unclaimed value is only ever
    ///         recoverable long after the fact.
    uint256 public constant SWEEP_DELAY = 180 days;

    struct Period {
        uint64  startTime;      // inclusive, GMT
        uint64  endTime;        // exclusive — the cut-off
        uint64  finalizedAt;    // zero while still open
        uint256 funded;         // reward token deposited for this period
        uint256 totalWeight;    // sum of every entrant's weight
        uint256 claimed;        // paid out so far
        uint256 entrants;       // wallets with non-zero weight
        bool    swept;          // the remainder was recovered; nothing further is owed
        string  label;          // "2026-W33" / "2026-08" — for humans and for audit
    }

    Period[] private _periods;

    /// @notice periodId => wallet => weight in that period.
    mapping(uint256 => mapping(address => uint256)) public weightIn;
    /// @notice periodId => wallet => already claimed.
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event PeriodOpened(uint256 indexed periodId, string label, uint64 startTime, uint64 endTime);
    event PeriodFunded(uint256 indexed periodId, uint256 amount, uint256 totalFunded);
    event WeightsWritten(uint256 indexed periodId, uint256 count, uint256 totalWeight);
    event PeriodFinalized(uint256 indexed periodId, uint256 funded, uint256 totalWeight, uint256 entrants);
    event Claimed(uint256 indexed periodId, address indexed account, uint256 amount);
    event Swept(uint256 indexed periodId, address indexed to, uint256 amount);

    constructor(address _rewardToken, address admin) {
        require(_rewardToken != address(0) && admin != address(0), "PRP: zero address");
        rewardToken = IERC20(_rewardToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(FUNDER_ROLE, admin);
    }

    // ─────────────────────────────────────────────────────────
    // Building a period
    // ─────────────────────────────────────────────────────────

    /// @notice Open a period. `label` records which week or month this is, so a reader can
    ///         check the cohort against the chain without trusting our arithmetic.
    function openPeriod(string calldata label, uint64 startTime, uint64 endTime)
        external onlyRole(OPERATOR_ROLE) returns (uint256 periodId)
    {
        require(endTime > startTime, "PRP: end before start");
        require(bytes(label).length > 0, "PRP: empty label");

        periodId = _periods.length;
        _periods.push(Period({
            startTime: startTime,
            endTime: endTime,
            finalizedAt: 0,
            funded: 0,
            totalWeight: 0,
            claimed: 0,
            entrants: 0,
            swept: false,
            label: label
        }));

        emit PeriodOpened(periodId, label, startTime, endTime);
    }

    /// @notice Deposit the period's USDT. Callable more than once — revenue arrives across
    ///         the period rather than in one lump.
    function fundPeriod(uint256 periodId, uint256 amount)
        external onlyRole(FUNDER_ROLE) nonReentrant
    {
        Period storage p = _period(periodId);
        require(p.finalizedAt == 0, "PRP: period finalized");
        require(amount > 0, "PRP: zero amount");

        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        p.funded += amount;

        emit PeriodFunded(periodId, amount, p.funded);
    }

    /// @notice Write the cohort, in batches.
    ///
    /// @dev Re-writing a wallet replaces its weight rather than adding to it, so a batch
    ///      sent twice — a retry after a timeout, say — leaves the same result rather than
    ///      doubling someone's share. That is worth the extra bookkeeping: a duplicated
    ///      batch is one of the likeliest operational mistakes here, and it would be
    ///      invisible until the pool ran dry.
    function setWeights(
        uint256 periodId,
        address[] calldata wallets,
        uint256[] calldata weights
    ) external onlyRole(OPERATOR_ROLE) {
        Period storage p = _period(periodId);
        require(p.finalizedAt == 0, "PRP: period finalized");
        require(wallets.length == weights.length && wallets.length > 0, "PRP: bad input");

        uint256 total = p.totalWeight;
        uint256 entrants = p.entrants;

        for (uint256 i = 0; i < wallets.length; i++) {
            address w = wallets[i];
            require(w != address(0), "PRP: zero wallet");

            uint256 prev = weightIn[periodId][w];
            uint256 next = weights[i];
            if (prev == next) continue;

            if (prev == 0 && next > 0) entrants += 1;
            if (prev > 0 && next == 0) entrants -= 1;

            total = total - prev + next;
            weightIn[periodId][w] = next;
        }

        p.totalWeight = total;
        p.entrants = entrants;

        emit WeightsWritten(periodId, wallets.length, total);
    }

    /// @notice Seal the period. After this the cohort and the amount are fixed and claims open.
    function finalize(uint256 periodId) external onlyRole(OPERATOR_ROLE) {
        Period storage p = _period(periodId);
        require(p.finalizedAt == 0, "PRP: already finalized");
        require(p.totalWeight > 0, "PRP: no entrants");
        // Funding is refused once sealed, so sealing an empty period would leave its
        // cohort permanently entitled to nothing, with no way to put that right.
        require(p.funded > 0, "PRP: not funded");
        // Sealing a period the contract cannot pay would hand out entitlements against
        // money that is not here, and the shortfall would land on whoever claimed last.
        require(rewardToken.balanceOf(address(this)) >= _outstanding() + p.funded, "PRP: not funded");

        p.finalizedAt = uint64(block.timestamp);
        emit PeriodFinalized(periodId, p.funded, p.totalWeight, p.entrants);
    }

    // ─────────────────────────────────────────────────────────
    // Claiming
    // ─────────────────────────────────────────────────────────

    /// @notice What `account` can take from a sealed period.
    function claimableOf(uint256 periodId, address account) public view returns (uint256) {
        if (periodId >= _periods.length) return 0;
        Period storage p = _periods[periodId];
        if (p.finalizedAt == 0) return 0;
        if (p.swept) return 0;
        if (hasClaimed[periodId][account]) return 0;

        uint256 w = weightIn[periodId][account];
        if (w == 0 || p.totalWeight == 0) return 0;
        return (p.funded * w) / p.totalWeight;
    }

    /// @notice Everything `account` can take across every sealed period.
    function totalClaimable(address account) external view returns (uint256 total) {
        for (uint256 i = 0; i < _periods.length; i++) total += claimableOf(i, account);
    }

    function claim(uint256 periodId) public nonReentrant {
        _claim(periodId);
    }

    /// @notice Claim several periods at once — a holder should not need one transaction per
    ///         week to collect a quarter's worth.
    function claimMany(uint256[] calldata periodIds) external nonReentrant {
        uint256 paid = 0;
        for (uint256 i = 0; i < periodIds.length; i++) {
            paid += _claimInner(periodIds[i]);
        }
        require(paid > 0, "PRP: nothing to claim");
    }

    function _claim(uint256 periodId) private {
        uint256 paid = _claimInner(periodId);
        require(paid > 0, "PRP: nothing to claim");
    }

    function _claimInner(uint256 periodId) private returns (uint256 amount) {
        amount = claimableOf(periodId, msg.sender);
        if (amount == 0) return 0;

        Period storage p = _periods[periodId];
        hasClaimed[periodId][msg.sender] = true;
        p.claimed += amount;

        rewardToken.safeTransfer(msg.sender, amount);
        emit Claimed(periodId, msg.sender, amount);
    }

    // ─────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────

    function periodCount() external view returns (uint256) { return _periods.length; }

    function getPeriod(uint256 periodId) external view returns (Period memory) {
        return _period(periodId);
    }

    /// @notice Reward token still owed across every sealed period.
    function outstanding() external view returns (uint256) { return _outstanding(); }

    function _outstanding() private view returns (uint256 total) {
        for (uint256 i = 0; i < _periods.length; i++) {
            Period storage p = _periods[i];
            if (p.finalizedAt == 0 || p.swept) continue;
            total += p.funded - p.claimed;
        }
    }

    function _period(uint256 periodId) private view returns (Period storage) {
        require(periodId < _periods.length, "PRP: no such period");
        return _periods[periodId];
    }

    // ─────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────

    /// @notice Recover what nobody claimed, long after the fact.
    ///
    /// @dev Six months, and only from a sealed period. A holder who is slow, or who lost
    ///      access for a while, must not find their reward gone because an operator tidied
    ///      up — that is the failure this delay exists to prevent, not a formality.
    function sweepUnclaimed(uint256 periodId, address to)
        external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant
    {
        Period storage p = _period(periodId);
        require(p.finalizedAt != 0, "PRP: not finalized");
        require(block.timestamp >= p.finalizedAt + SWEEP_DELAY, "PRP: too early");
        require(to != address(0), "PRP: zero recipient");

        uint256 amount = p.funded - p.claimed;
        require(amount > 0, "PRP: nothing unclaimed");

        // Marking the period swept is what actually closes it. Setting `claimed = funded`
        // alone left `claimableOf` still quoting a share to anyone who had not claimed —
        // and their claim would then have been paid out of another period's money, which
        // is only discovered by whoever comes last and finds nothing there.
        p.swept = true;
        p.claimed = p.funded;
        rewardToken.safeTransfer(to, amount);
        emit Swept(periodId, to, amount);
    }

    /// @notice Recover a token sent here by mistake. The reward token is refused — it is
    ///         owed to holders, and `sweepUnclaimed` is its only exit.
    function rescueToken(address token, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(token != address(rewardToken), "PRP: use sweepUnclaimed");
        require(to != address(0), "PRP: zero recipient");
        IERC20(token).safeTransfer(to, amount);
    }
}
