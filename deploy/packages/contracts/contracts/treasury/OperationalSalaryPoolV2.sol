// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IStewardCouncil {
    function isActiveMember(address wallet) external view returns (bool);
}

interface ISeedBudgetV5b {
    function release(uint8 slot, address recipient, uint256 amount) external;
    function slotTotalReceived(uint8 slot) external view returns (uint256);
}

/// @title OperationalSalaryPoolV2 — Policy contract for SEED Operational slot (20%)
/// @notice
///   Does NOT hold USDT. Tracks member registry + per-member share % + weekly maxout.
///   On `claim()`: computes member's claimable amount, then calls
///   `SeedBudgetV5b.release(SLOT_OPERATIONAL, member, amount)` which transfers
///   USDT from the central vault directly to the member (with fee deduction).
///
///   Entitlement model (simple, MVP):
///     entitledTotal = sharePctBps × seedBudget.slotTotalReceived(OPERATIONAL) / 10_000
///     claimable     = entitledTotal - totalClaimed
///     weeklyCapped  = min(claimable, weeklyMaxoutUsdt - weeklyAllocated[currentWeek])
///
///   Excess past weekly maxout rolls over (member can claim more next week).
contract OperationalSalaryPoolV2 is ReentrancyGuard {
    address public immutable owner;
    IStewardCouncil public immutable council;
    ISeedBudgetV5b public immutable seedBudget;

    uint8 public constant SLOT_OPERATIONAL = 1;

    struct PoolMember {
        uint16  sharePctBps;       // 700 = 7%; sum across active = 10000
        uint128 weeklyMaxoutUsdt;  // hard cap per week (6-dec USDT)
        uint128 totalClaimed;      // lifetime claimed (USDT)
        bool    enrolled;
    }

    mapping(address => PoolMember) public members;
    address[] private _memberList;
    mapping(address => uint256) private _memberIndex; // 1-based

    mapping(address => mapping(uint256 => uint128)) public allocatedInWeek;

    uint16 public totalShareBps;

    event MemberEnrolled(address indexed wallet, uint16 sharePctBps, uint128 weeklyMaxoutUsdt);
    event MemberUpdated(address indexed wallet, uint16 sharePctBps, uint128 weeklyMaxoutUsdt);
    event MemberRemoved(address indexed wallet);
    event Claimed(address indexed wallet, uint256 weekIdx, uint256 amount);

    modifier onlyOwner() { require(msg.sender == owner, "OSPv2: not owner"); _; }

    constructor(address _council, address _seedBudget, address _owner) {
        require(_council    != address(0), "OSPv2: zero council");
        require(_seedBudget != address(0), "OSPv2: zero seedBudget");
        require(_owner      != address(0), "OSPv2: zero owner");
        council    = IStewardCouncil(_council);
        seedBudget = ISeedBudgetV5b(_seedBudget);
        owner      = _owner;
    }

    // ─── Owner: member management ─────────────────────────────────────────

    function enrollMember(
        address wallet,
        uint16 sharePctBps,
        uint128 weeklyMaxoutUsdt
    ) external onlyOwner {
        require(council.isActiveMember(wallet), "OSPv2: not council member");
        require(!members[wallet].enrolled, "OSPv2: already enrolled");
        require(sharePctBps > 0, "OSPv2: zero share");
        require(uint256(totalShareBps) + sharePctBps <= 10_000, "OSPv2: total >100%");

        members[wallet] = PoolMember({
            sharePctBps:      sharePctBps,
            weeklyMaxoutUsdt: weeklyMaxoutUsdt,
            totalClaimed:     0,
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
        PoolMember storage m = members[wallet];
        require(m.enrolled, "OSPv2: not enrolled");
        uint16 newTotal = totalShareBps - m.sharePctBps + newSharePctBps;
        require(newTotal <= 10_000, "OSPv2: total >100%");
        totalShareBps = newTotal;
        m.sharePctBps = newSharePctBps;
        m.weeklyMaxoutUsdt = newWeeklyMaxoutUsdt;
        emit MemberUpdated(wallet, newSharePctBps, newWeeklyMaxoutUsdt);
    }

    function removeMember(address wallet) external onlyOwner {
        uint256 idx1 = _memberIndex[wallet];
        require(idx1 != 0, "OSPv2: not enrolled");
        PoolMember storage m = members[wallet];
        totalShareBps -= m.sharePctBps;
        m.enrolled = false;
        m.sharePctBps = 0;
        // totalClaimed preserved (history)

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

    // ─── Member: claim ────────────────────────────────────────────────────

    /// @notice Compute member's claimable amount (gross — before fee deduction in vault).
    function claimable(address member) public view returns (uint256) {
        PoolMember memory m = members[member];
        if (!m.enrolled || m.sharePctBps == 0) return 0;

        uint256 totalReceived = seedBudget.slotTotalReceived(SLOT_OPERATIONAL);
        uint256 entitledTotal = (totalReceived * m.sharePctBps) / 10_000;
        if (entitledTotal <= m.totalClaimed) return 0;
        uint256 remaining = entitledTotal - m.totalClaimed;

        // Weekly maxout cap
        uint256 weekIdx = block.timestamp / 7 days;
        uint128 used = allocatedInWeek[member][weekIdx];
        if (m.weeklyMaxoutUsdt > 0) {
            if (used >= m.weeklyMaxoutUsdt) return 0;
            uint256 weekRemaining = m.weeklyMaxoutUsdt - used;
            if (remaining > weekRemaining) remaining = weekRemaining;
        }
        return remaining;
    }

    /// @notice Member claims their entitled USDT. Calls SeedBudgetV5b.release().
    function claim() external nonReentrant {
        uint256 amount = claimable(msg.sender);
        require(amount > 0, "OSPv2: nothing to claim");

        PoolMember storage m = members[msg.sender];
        m.totalClaimed += uint128(amount);

        uint256 weekIdx = block.timestamp / 7 days;
        allocatedInWeek[msg.sender][weekIdx] += uint128(amount);

        // Vault transfers gross USDT, deducts fee, sends net to member + fee to feeReceiver
        seedBudget.release(SLOT_OPERATIONAL, msg.sender, amount);

        emit Claimed(msg.sender, weekIdx, amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────

    function memberCount() external view returns (uint256) { return _memberList.length; }
    function memberAt(uint256 i) external view returns (address) { return _memberList[i]; }
    function currentWeekIdx() external view returns (uint256) { return block.timestamp / 7 days; }
}
