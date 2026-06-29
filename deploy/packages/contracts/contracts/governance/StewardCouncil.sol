// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title StewardCouncil — master council member registry (Phase 1 of governance)
/// @notice Owner-only Add/Edit/Delete. Used by other pools/contracts to query
///         active member set and 1-member-1-vote weights. MFP-NFT weighted
///         voting deferred to a future DAO upgrade.
///
/// @dev Owner identity is set in constructor and immutable. Mainnet deploy
///      should pass DAOGovernor as owner once governance is fully on-chain.
contract StewardCouncil {
    // ─── Storage ───────────────────────────────────────────────────────

    address public immutable owner;

    struct Member {
        string  memberId;
        string  role;
        string  rightLabel;
        string  note;
        bool    active;
        uint64  addedAt;
    }

    /// @notice wallet => member record. wallet=0x0 means unset.
    mapping(address => Member) public members;
    address[] private _walletList;
    mapping(address => uint256) private _walletIndex; // 1-based to detect unset

    uint256 public activeCount;

    // ─── Events ────────────────────────────────────────────────────────

    event MemberAdded(address indexed wallet, string memberId, string role);
    event MemberUpdated(address indexed wallet, string role, string rightLabel, string note);
    event MemberRemoved(address indexed wallet);
    event MemberActiveChanged(address indexed wallet, bool active);

    // ─── Modifiers ─────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "SC: not owner");
        _;
    }

    // ─── Constructor ───────────────────────────────────────────────────

    constructor(address _owner) {
        require(_owner != address(0), "SC: zero owner");
        owner = _owner;
    }

    // ─── Owner: Add / Edit / Delete ────────────────────────────────────

    function addMember(
        address wallet,
        string calldata memberId,
        string calldata role,
        string calldata rightLabel,
        string calldata note
    ) external onlyOwner {
        require(wallet != address(0), "SC: zero wallet");
        require(_walletIndex[wallet] == 0, "SC: already member");

        members[wallet] = Member({
            memberId:   memberId,
            role:       role,
            rightLabel: rightLabel,
            note:       note,
            active:     true,
            addedAt:    uint64(block.timestamp)
        });
        _walletList.push(wallet);
        _walletIndex[wallet] = _walletList.length;
        activeCount++;

        emit MemberAdded(wallet, memberId, role);
    }

    function updateMember(
        address wallet,
        string calldata role,
        string calldata rightLabel,
        string calldata note
    ) external onlyOwner {
        require(_walletIndex[wallet] != 0, "SC: not member");
        Member storage m = members[wallet];
        m.role       = role;
        m.rightLabel = rightLabel;
        m.note       = note;
        emit MemberUpdated(wallet, role, rightLabel, note);
    }

    function setActive(address wallet, bool active) external onlyOwner {
        require(_walletIndex[wallet] != 0, "SC: not member");
        Member storage m = members[wallet];
        if (m.active == active) return;
        m.active = active;
        if (active) activeCount++;
        else activeCount--;
        emit MemberActiveChanged(wallet, active);
    }

    function removeMember(address wallet) external onlyOwner {
        uint256 idx1 = _walletIndex[wallet];
        require(idx1 != 0, "SC: not member");

        Member storage m = members[wallet];
        if (m.active) activeCount--;

        // Swap-remove from list
        uint256 idx = idx1 - 1;
        uint256 lastIdx = _walletList.length - 1;
        if (idx != lastIdx) {
            address lastWallet = _walletList[lastIdx];
            _walletList[idx] = lastWallet;
            _walletIndex[lastWallet] = idx + 1;
        }
        _walletList.pop();
        delete _walletIndex[wallet];
        delete members[wallet];

        emit MemberRemoved(wallet);
    }

    // ─── Public Views ──────────────────────────────────────────────────

    function isMember(address wallet) external view returns (bool) {
        return _walletIndex[wallet] != 0;
    }

    function isActiveMember(address wallet) external view returns (bool) {
        return _walletIndex[wallet] != 0 && members[wallet].active;
    }

    function memberCount() external view returns (uint256) {
        return _walletList.length;
    }

    /// @notice Return paginated member list. Pass start=0,count=type(uint256).max for all.
    function getMembers(uint256 start, uint256 count)
        external
        view
        returns (address[] memory wallets)
    {
        uint256 total = _walletList.length;
        if (start >= total) return new address[](0);
        uint256 end = start + count;
        if (end > total) end = total;
        wallets = new address[](end - start);
        for (uint256 i = start; i < end; i++) {
            wallets[i - start] = _walletList[i];
        }
    }

    function getActiveMembers() external view returns (address[] memory active) {
        uint256 total = _walletList.length;
        active = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < total; i++) {
            address w = _walletList[i];
            if (members[w].active) {
                active[idx++] = w;
            }
        }
    }
}
