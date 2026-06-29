// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title DAOGovernor — On-chain DAO Governance for MissionChain
/// @notice Replaces Gnosis Safe. Two-phase governance model:
///         Phase 1 (Owner): Deployer controls via DEFAULT_ADMIN_ROLE.
///                          Owner can set temporary Ban Thường Trực (BTC) members.
///         Phase 2 (DAO):   After renounceOwnershipToDAO() — irreversible.
///                          Only DAO governance controls: 3/5 BTC + ≥75% MFP staked weight.
/// @dev Timelocks: 24h (PARAMETER/BUDGET), 7d (STRUCTURAL), 0 (EMERGENCY).
contract DAOGovernor is AccessControl, ReentrancyGuard {

    // ─── Roles ───────────────────────────────────────────────────────────────

    /// @notice Ban Thường Trực (Executive Committee) member role
    bytes32 public constant BTC_MEMBER_ROLE = keccak256("BTC_MEMBER");

    // ─── Constants ───────────────────────────────────────────────────────────

    /// @notice Number of BTC members in the Executive Committee
    uint256 public constant BTC_MEMBER_COUNT = 5;

    /// @notice Required signatures for quorum (3 out of 5)
    uint256 public constant BTC_QUORUM = 3;

    /// @notice Timelock duration for parameter adjustments (24 hours)
    uint256 public constant TIMELOCK_PARAMETER = 24 hours;

    /// @notice Timelock duration for budget actions (24 hours)
    uint256 public constant TIMELOCK_BUDGET = 24 hours;

    /// @notice Timelock duration for structural changes (7 days)
    uint256 public constant TIMELOCK_STRUCTURAL = 7 days;

    /// @notice Timelock for emergency actions (instant, no delay)
    uint256 public constant TIMELOCK_EMERGENCY = 0;

    // ─── Enums ───────────────────────────────────────────────────────────────

    /// @notice Categories of proposals, each with a different timelock
    enum TimelockCategory {
        PARAMETER,   // 24 hours — adjust emission rates, multipliers, percentages
        BUDGET,      // 24 hours — treasury transfers, pool allocations
        STRUCTURAL,  // 7 days   — contract upgrades, role changes, supply expansion
        EMERGENCY    // 0        — pause all contracts, freeze accounts
    }

    /// @notice States a proposal can be in
    enum ProposalState {
        PENDING,    // Created, awaiting approvals
        APPROVED,   // Has 3/5 BTC approvals; can be executed after timelock
        EXECUTED,   // Successfully executed
        CANCELLED   // Cancelled (reserved for future use)
    }

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct Proposal {
        address proposer;
        address target;
        bytes callData;
        TimelockCategory category;
        uint256 createdAt;
        uint256 approvalCount;
        ProposalState state;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    /// @notice True when Phase 2 (DAO mode) is active; false during Phase 1 (Owner mode)
    bool public daoActive;

    /// @notice The original deployer address (immutable identity reference)
    address public originalOwner;

    /// @notice Sequential proposal counter (1-indexed)
    uint256 public proposalCount;

    /// @notice Proposal data indexed by proposal ID
    mapping(uint256 => Proposal) public proposals;

    /// @notice Per-proposal approval tracking: proposalId → member → hasApproved
    mapping(uint256 => mapping(address => bool)) public hasApproved;

    /// @notice Current BTC member addresses (array of 5)
    address[5] public btcMembers;

    // ─── Events ──────────────────────────────────────────────────────────────

    event TemporaryMembersSet(address[5] members);
    event OwnershipRenounced(address indexed previousOwner);
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        address indexed target,
        TimelockCategory category
    );
    event ProposalApproved(
        uint256 indexed proposalId,
        address indexed approver,
        uint256 approvalCount
    );
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCancelled(uint256 indexed proposalId);
    event EmergencyPauseExecuted(address indexed target, address indexed caller);

    // ─── Constructor ─────────────────────────────────────────────────────────

    /// @param admin The deployer address granted DEFAULT_ADMIN_ROLE (Phase 1 owner)
    constructor(address admin) {
        require(admin != address(0), "DAO: zero admin");
        originalOwner = admin;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        // BTC_MEMBER_ROLE admin is also DEFAULT_ADMIN_ROLE holder
        _setRoleAdmin(BTC_MEMBER_ROLE, DEFAULT_ADMIN_ROLE);
    }

    // ─── Phase 1: Owner Functions ─────────────────────────────────────────────

    /// @notice Set 5 temporary BTC (Ban Thường Trực) members — Owner only, Phase 1 only
    /// @dev Revokes old BTC roles before granting new ones
    /// @param members Array of exactly 5 member addresses
    function setTemporaryMembers(address[5] calldata members) external {
        // Check daoActive first so we emit a clear error (not AccessControl custom error)
        require(!daoActive, "DAO: already active");
        _checkRole(DEFAULT_ADMIN_ROLE);

        // Revoke existing BTC roles
        for (uint256 i = 0; i < BTC_MEMBER_COUNT; i++) {
            address old = btcMembers[i];
            if (old != address(0) && hasRole(BTC_MEMBER_ROLE, old)) {
                _revokeRole(BTC_MEMBER_ROLE, old);
            }
        }

        // Grant new BTC roles
        for (uint256 i = 0; i < BTC_MEMBER_COUNT; i++) {
            require(members[i] != address(0), "DAO: zero member address");
            btcMembers[i] = members[i];
            _grantRole(BTC_MEMBER_ROLE, members[i]);
        }

        emit TemporaryMembersSet(members);
    }

    /// @notice Transition to Phase 2 (DAO mode) — ONE-TIME, IRREVERSIBLE
    /// @dev Revokes DEFAULT_ADMIN_ROLE from original owner.
    ///      Grants DEFAULT_ADMIN_ROLE to this contract (self-governance).
    ///      After this, only DAO governance proposals can modify the system.
    function renounceOwnershipToDAO() external {
        // Check daoActive first so we emit a clear error (not AccessControl custom error)
        require(!daoActive, "DAO: already active");
        _checkRole(DEFAULT_ADMIN_ROLE);

        daoActive = true;

        // Grant admin to the DAOGovernor contract itself (self-administered)
        _grantRole(DEFAULT_ADMIN_ROLE, address(this));

        // Revoke from original owner
        _revokeRole(DEFAULT_ADMIN_ROLE, originalOwner);

        emit OwnershipRenounced(originalOwner);
    }

    // ─── Proposals ────────────────────────────────────────────────────────────

    /// @notice Create a new proposal — BTC member only
    /// @dev Proposer automatically counts as 1 approval
    /// @param target Address of the contract to call
    /// @param callData ABI-encoded function call
    /// @param category Timelock category determining the delay before execution
    /// @return proposalId The newly created proposal ID
    function propose(
        address target,
        bytes calldata callData,
        TimelockCategory category
    ) external nonReentrant returns (uint256 proposalId) {
        require(hasRole(BTC_MEMBER_ROLE, msg.sender), "DAO: not BTC member");
        require(target != address(0), "DAO: zero target");

        proposalCount++;
        proposalId = proposalCount;

        Proposal storage p = proposals[proposalId];
        p.proposer = msg.sender;
        p.target = target;
        p.callData = callData;
        p.category = category;
        p.createdAt = block.timestamp;
        p.approvalCount = 1; // proposer auto-approves
        p.state = ProposalState.PENDING;

        hasApproved[proposalId][msg.sender] = true;

        emit ProposalCreated(proposalId, msg.sender, target, category);
        emit ProposalApproved(proposalId, msg.sender, 1);
    }

    /// @notice Approve a pending proposal — BTC member only
    /// @dev Marks proposal as APPROVED once 3/5 threshold is reached
    /// @param proposalId The proposal to approve
    function approve(uint256 proposalId) external {
        require(hasRole(BTC_MEMBER_ROLE, msg.sender), "DAO: not BTC member");

        Proposal storage p = proposals[proposalId];
        require(p.state == ProposalState.PENDING, "DAO: not pending");
        require(!hasApproved[proposalId][msg.sender], "DAO: already approved");

        hasApproved[proposalId][msg.sender] = true;
        p.approvalCount++;

        emit ProposalApproved(proposalId, msg.sender, p.approvalCount);

        if (p.approvalCount >= BTC_QUORUM) {
            p.state = ProposalState.APPROVED;
        }
    }

    /// @notice Execute an approved proposal after its timelock has expired
    /// @dev Anyone can call execute — not restricted to BTC members
    /// @param proposalId The proposal to execute
    function execute(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        require(p.state == ProposalState.APPROVED, "DAO: not approved");

        uint256 timelockDuration = _timelockFor(p.category);
        require(
            block.timestamp >= p.createdAt + timelockDuration,
            "DAO: timelock not expired"
        );

        // Mark executed before external call (reentrancy protection)
        p.state = ProposalState.EXECUTED;

        // Execute the proposal call
        (bool success, bytes memory returnData) = p.target.call(p.callData);
        if (!success) {
            // Bubble up revert reason if present
            if (returnData.length > 0) {
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            }
            revert("DAO: execution failed");
        }

        emit ProposalExecuted(proposalId);
    }

    /// @notice Execute an emergency pause on a target contract — instant, no timelock
    /// @dev Requires 3/5 BTC members provided as signers array (verified on-chain).
    ///      Calls `pause()` on the target contract. No proposal needed — instant.
    /// @param target Contract to pause
    /// @param signers Array of BTC member addresses authorizing the action
    function emergencyPause(address target, address[] calldata signers)
        external
        nonReentrant
    {
        require(hasRole(BTC_MEMBER_ROLE, msg.sender), "DAO: not BTC member");
        require(target != address(0), "DAO: zero target");
        require(signers.length >= BTC_QUORUM, "DAO: insufficient BTC signatures");

        // Validate all signers are BTC members and no duplicates
        for (uint256 i = 0; i < signers.length; i++) {
            require(hasRole(BTC_MEMBER_ROLE, signers[i]), "DAO: signer not BTC member");
            for (uint256 j = i + 1; j < signers.length; j++) {
                require(signers[i] != signers[j], "DAO: duplicate signer");
            }
        }

        emit EmergencyPauseExecuted(target, msg.sender);

        // Call pause() on target — EMERGENCY category, no timelock
        (bool success, bytes memory returnData) = target.call(
            abi.encodeWithSignature("pause()")
        );
        if (!success) {
            if (returnData.length > 0) {
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            }
            revert("DAO: emergency pause failed");
        }
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    /// @notice Get full proposal data as a tuple
    /// @param proposalId The proposal ID
    /// @return proposer Proposer address
    /// @return target Target contract address
    /// @return callData Encoded call data
    /// @return category Timelock category
    /// @return createdAt Creation timestamp
    /// @return approvalCount Current approval count
    /// @return state Current proposal state (0=PENDING, 1=APPROVED, 2=EXECUTED, 3=CANCELLED)
    /// @return timelockExpiry Timestamp when timelock expires (createdAt + delay)
    function getProposal(uint256 proposalId)
        external
        view
        returns (
            address proposer,
            address target,
            bytes memory callData,
            TimelockCategory category,
            uint256 createdAt,
            uint256 approvalCount,
            ProposalState state,
            uint256 timelockExpiry
        )
    {
        Proposal storage p = proposals[proposalId];
        return (
            p.proposer,
            p.target,
            p.callData,
            p.category,
            p.createdAt,
            p.approvalCount,
            p.state,
            p.createdAt + _timelockFor(p.category)
        );
    }

    /// @notice Check whether a proposal is ready to execute (approved + timelock passed)
    /// @param proposalId The proposal ID
    /// @return True if executable
    function isExecutable(uint256 proposalId) external view returns (bool) {
        Proposal storage p = proposals[proposalId];
        if (p.state != ProposalState.APPROVED) return false;
        return block.timestamp >= p.createdAt + _timelockFor(p.category);
    }

    // ─── Internal Helpers ─────────────────────────────────────────────────────

    /// @dev Returns the timelock duration for a given category
    function _timelockFor(TimelockCategory category) internal pure returns (uint256) {
        if (category == TimelockCategory.PARAMETER) return TIMELOCK_PARAMETER;
        if (category == TimelockCategory.BUDGET)    return TIMELOCK_BUDGET;
        if (category == TimelockCategory.STRUCTURAL) return TIMELOCK_STRUCTURAL;
        return TIMELOCK_EMERGENCY; // EMERGENCY
    }
}
