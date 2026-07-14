// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "../interfaces/ILockManager.sol";

/// @title AirdropDistributor — Merkle proof airdrop with Hybrid Token-Level Lock vesting
/// @notice 0.25% = 17.5M MIC distributed via merkle tree verification.
///         Tokens go DIRECTLY to claimant wallet, locked via LockManager (no claim needed).
///         Vesting: 10% cliff after 6 months, 2.5%/month thereafter.
contract AirdropDistributor is AccessControl {
    using SafeERC20 for IERC20;

    // ─── Constants ──────────────────────────────────────────────────────────────
    /// @dev 6 months cliff = 180 days in seconds
    uint256 public constant CLIFF_DURATION = 180 days;
    /// @dev 10% cliff unlock in basis points
    uint256 public constant CLIFF_UNLOCK_BPS = 1000;
    /// @dev 2.5%/month monthly unlock in basis points
    uint256 public constant MONTHLY_UNLOCK_BPS = 250;

    // ─── State ──────────────────────────────────────────────────────────────────
    IERC20 public immutable micToken;
    ILockManager public immutable lockManager;

    bytes32 public merkleRoot;

    /// @dev leaf = keccak256(abi.encodePacked(account, amount)); prevents double-claim
    mapping(bytes32 => bool) public claimed;

    /// @dev Total MIC claimed so far
    uint256 public totalClaimed;

    // ─── Events ─────────────────────────────────────────────────────────────────
    event AirdropClaimed(address indexed account, uint256 amount);
    event MerkleRootUpdated(bytes32 oldRoot, bytes32 newRoot);

    // ─── Constructor ────────────────────────────────────────────────────────────
    /// @param _micToken  Address of MICToken.sol (BEP-20)
    /// @param _lockManager Address of LockManager.sol
    /// @param admin      Address to receive DEFAULT_ADMIN_ROLE
    constructor(address _micToken, address _lockManager, address admin) {
        require(_micToken != address(0), "Airdrop: zero micToken");
        require(_lockManager != address(0), "Airdrop: zero lockManager");
        require(admin != address(0), "Airdrop: zero admin");
        micToken = IERC20(_micToken);
        lockManager = ILockManager(_lockManager);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ─── Admin ──────────────────────────────────────────────────────────────────

    /// @notice Set or update the Merkle root for the active airdrop snapshot.
    /// @param _root New Merkle root
    function setMerkleRoot(bytes32 _root) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit MerkleRootUpdated(merkleRoot, _root);
        merkleRoot = _root;
    }

    /// @notice Withdraw unclaimed tokens after airdrop period ends.
    /// @param to Recipient of remaining MIC
    function withdrawRemaining(address to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(to != address(0), "Airdrop: zero recipient");
        uint256 balance = micToken.balanceOf(address(this));
        require(balance > 0, "Airdrop: no balance");
        micToken.safeTransfer(to, balance);
    }

    // ─── Claim ──────────────────────────────────────────────────────────────────

    /// @notice Claim airdrop with a valid Merkle proof.
    ///         MIC goes directly to msg.sender's wallet, then locked via LockManager.
    ///         Vesting: 10% cliff @ 6 months, 2.5%/month thereafter.
    /// @param proof Merkle proof for (msg.sender, amount) leaf
    /// @param amount MIC amount (18 decimals) this address is entitled to
    function claim(bytes32[] calldata proof, uint256 amount) external {
        require(amount > 0, "Airdrop: zero amount");

        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        require(!claimed[leaf], "Airdrop: already claimed");
        require(MerkleProof.verify(proof, merkleRoot, leaf), "Airdrop: invalid proof");

        // Mark claimed before external calls (CEI pattern)
        claimed[leaf] = true;
        totalClaimed += amount;

        // Hybrid Token-Level Lock: token goes directly to claimant's wallet
        micToken.safeTransfer(msg.sender, amount);

        // Lock via LockManager — claimant cannot transfer locked tokens
        // Vesting: cliff 6 months (10%), then 2.5%/month
        lockManager.createSchedule(
            msg.sender,
            amount,
            CLIFF_DURATION,
            CLIFF_UNLOCK_BPS,
            MONTHLY_UNLOCK_BPS
        );

        emit AirdropClaimed(msg.sender, amount);
    }

    // ─── Views ──────────────────────────────────────────────────────────────────

    /// @notice Check if a given (account, amount) leaf has been claimed.
    /// @param account Claimant address
    /// @param amount  Claim amount
    function isClaimed(address account, uint256 amount) external view returns (bool) {
        bytes32 leaf = keccak256(abi.encodePacked(account, amount));
        return claimed[leaf];
    }
}
