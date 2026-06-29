// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IStewardCouncil {
    function isActiveMember(address wallet) external view returns (bool);
}

/// @title OperationalSalaryPool — 20% of SEED revenue distributed to council members
/// @notice
///   - Owner sets per-member sharePctBps (sum = 10000 = 100% of pool slice) and
///     weeklyMaxoutUsdt (USDT 6-decimals).
///   - On `receiveAndDistribute(amount)` from SeedBudget (DISTRIBUTOR_ROLE):
///       For each active member, slice = amount × sharePctBps / 10000.
///       Cap to (weeklyMaxoutUsdt - allocatedThisWeek). Any excess stays in
///       the pool's USDT balance (rolls over implicitly).
///   - Member calls `claim()` → USDT to wallet. No vesting.
///
/// @dev Week boundary: floor(timestamp / 7 days). Block 0 = Thu 1 Jan 1970 UTC,
///      so weekIdx flips on Thursday 00:00 UTC. Acceptable approximation for
///      operational purposes (anh's spec says "Mon-Sun GMT" but the +/-3 day
///      offset is operational, not financial).
contract OperationalSalaryPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ─────────────────────────────────────────────────────────

    address public immutable owner;
    address public distributor; // SeedBudget contract — set by owner after deploy

    // ─── Storage ───────────────────────────────────────────────────────

    IERC20 public immutable usdt;
    IStewardCouncil public immutable council;

    struct PoolMember {
        uint16  sharePctBps;     // 700 = 7%; sum across active = 10000
        uint128 weeklyMaxoutUsdt; // 6-dec USDT
        uint128 claimable;        // pending claim balance
        uint128 totalClaimed;     // lifetime claimed
        uint128 totalAllocated;   // lifetime allocated (claimed + pending)
        bool    enrolled;
    }

    mapping(address => PoolMember) public poolMembers;
    address[] private _memberList;
    mapping(address => uint256) private _memberIndex; // 1-based

    /// @notice wallet => weekIdx => allocated this week (USDT, 6-dec)
    mapping(address => mapping(uint256 => uint128)) public allocatedInWeek;

    uint16 public totalShareBps;

    // ─── Events ────────────────────────────────────────────────────────

    event MemberEnrolled(address indexed wallet, uint16 sharePctBps, uint128 weeklyMaxoutUsdt);
    event MemberUpdated(address indexed wallet, uint16 sharePctBps, uint128 weeklyMaxoutUsdt);
    event MemberRemoved(address indexed wallet);
    event Distributed(uint256 totalIncoming, uint256 totalAllocated, uint256 excess);
    event Allocated(address indexed wallet, uint256 weekIdx, uint256 amount, uint256 cappedAt);
    event Claimed(address indexed wallet, uint256 amount);
    event DistributorSet(address distributor);

    // ─── Modifiers ─────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "OSP: not owner");
        _;
    }
    modifier onlyDistributor() {
        require(msg.sender == distributor, "OSP: not distributor");
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────

    constructor(address _usdt, address _council, address _owner) {
        require(_usdt != address(0), "OSP: zero usdt");
        require(_council != address(0), "OSP: zero council");
        require(_owner != address(0), "OSP: zero owner");
        usdt    = IERC20(_usdt);
        council = IStewardCouncil(_council);
        owner   = _owner;
    }

    // ─── Owner: configuration ──────────────────────────────────────────

    function setDistributor(address _distributor) external onlyOwner {
        distributor = _distributor;
        emit DistributorSet(_distributor);
    }

    function enrollMember(
        address wallet,
        uint16 sharePctBps,
        uint128 weeklyMaxoutUsdt
    ) external onlyOwner {
        require(council.isActiveMember(wallet), "OSP: not council member");
        require(!poolMembers[wallet].enrolled, "OSP: already enrolled");
        require(sharePctBps > 0, "OSP: zero share");
        require(uint256(totalShareBps) + sharePctBps <= 10000, "OSP: total >100%");

        poolMembers[wallet] = PoolMember({
            sharePctBps:      sharePctBps,
            weeklyMaxoutUsdt: weeklyMaxoutUsdt,
            claimable:        0,
            totalClaimed:     0,
            totalAllocated:   0,
            enrolled:         true
        });
        _memberList.push(wallet);
        _memberIndex[wallet] = _memberList.length;
        totalShareBps += sharePctBps;

        emit MemberEnrolled(wallet, sharePctBps, weeklyMaxoutUsdt);
    }

    function updateMember(
        address wallet,
        uint16 newSharePctBps,
        uint128 newWeeklyMaxoutUsdt
    ) external onlyOwner {
        PoolMember storage m = poolMembers[wallet];
        require(m.enrolled, "OSP: not enrolled");

        // Adjust totalShareBps
        uint16 oldShare = m.sharePctBps;
        uint16 newTotal = totalShareBps - oldShare + newSharePctBps;
        require(newTotal <= 10000, "OSP: total >100%");
        totalShareBps = newTotal;

        m.sharePctBps      = newSharePctBps;
        m.weeklyMaxoutUsdt = newWeeklyMaxoutUsdt;

        emit MemberUpdated(wallet, newSharePctBps, newWeeklyMaxoutUsdt);
    }

    function removeMember(address wallet) external onlyOwner {
        uint256 idx1 = _memberIndex[wallet];
        require(idx1 != 0, "OSP: not enrolled");
        PoolMember storage m = poolMembers[wallet];
        totalShareBps -= m.sharePctBps;
        // Note: we keep claimable balance available for the wallet to claim
        // even after removal. Only enrollment metadata removed.
        m.enrolled = false;
        m.sharePctBps = 0;

        // Swap-remove from list
        uint256 idx = idx1 - 1;
        uint256 lastIdx = _memberList.length - 1;
        if (idx != lastIdx) {
            address lastWallet = _memberList[lastIdx];
            _memberList[idx] = lastWallet;
            _memberIndex[lastWallet] = idx + 1;
        }
        _memberList.pop();
        delete _memberIndex[wallet];

        emit MemberRemoved(wallet);
    }

    // ─── Distributor: receive USDT and split ───────────────────────────

    /// @notice Called by SeedBudget when SEED purchase completes.
    /// @dev Caller must approve USDT spend by this contract first.
    function receiveAndDistribute(uint256 amount) external onlyDistributor nonReentrant {
        require(amount > 0, "OSP: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        uint256 weekIdx = block.timestamp / 7 days;
        uint256 totalAllocated = 0;

        for (uint256 i = 0; i < _memberList.length; i++) {
            address w = _memberList[i];
            PoolMember storage m = poolMembers[w];
            if (m.sharePctBps == 0) continue;
            // Skip inactive on council
            if (!council.isActiveMember(w)) continue;

            uint256 slice = (amount * m.sharePctBps) / 10000;
            if (slice == 0) continue;

            uint128 used = allocatedInWeek[w][weekIdx];
            uint128 cap = m.weeklyMaxoutUsdt;
            if (cap > 0 && used + slice > cap) {
                // Cap to remaining maxout
                slice = cap > used ? cap - used : 0;
            }
            if (slice == 0) continue;

            allocatedInWeek[w][weekIdx] = used + uint128(slice);
            m.claimable        += uint128(slice);
            m.totalAllocated   += uint128(slice);
            totalAllocated     += slice;

            emit Allocated(w, weekIdx, slice, cap);
        }

        emit Distributed(amount, totalAllocated, amount - totalAllocated);
    }

    // ─── Member: claim ─────────────────────────────────────────────────

    function claim() external nonReentrant {
        PoolMember storage m = poolMembers[msg.sender];
        uint128 amount = m.claimable;
        require(amount > 0, "OSP: nothing to claim");
        m.claimable = 0;
        m.totalClaimed += amount;

        usdt.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ─── Public views ──────────────────────────────────────────────────

    function memberCount() external view returns (uint256) { return _memberList.length; }
    function memberAt(uint256 i) external view returns (address) { return _memberList[i]; }
    function poolBalance() external view returns (uint256) { return usdt.balanceOf(address(this)); }
    function currentWeekIdx() external view returns (uint256) { return block.timestamp / 7 days; }
}
