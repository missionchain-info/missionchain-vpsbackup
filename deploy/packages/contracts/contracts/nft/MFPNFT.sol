// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MFPNFT — Mission Founding Partner NFT
/// @notice ERC-721 governance credential for Founders & Strategic Partners
///         Max supply: 25,000 (+ 25,000 expansion requires DAO vote)
///         Staking multiplier: ×10, no expiry (permanent credential)
/// @dev Bundled with SEED packages (20/60/150/350 per package tier)
contract MFPNFT is ERC721Enumerable, AccessControl, ReentrancyGuard {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ─────────────────────────────────────────────────────────────────────────
    // The two caps MUST match the contract already live on BSC mainnet
    // (0xAE6F32A6fdf80F5e54ba85441386dBA6a381f565). The MFP hard cap is published
    // as an immutable protocol invariant in the White Paper and on missionchain.io,
    // and it is enforced on every mint, so a redeploy with a different value would
    // silently break that promise. Verified against mainnet 2026-08-02.
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Initial max supply — 2,500 (hard cap per White Paper §E.3)
    uint256 public constant INITIAL_CAP = 2_500;

    /// @notice Maximum possible expansion (requires DAO vote) — additional 2,500
    uint256 public constant EXPANSION_CAP = 2_500;

    // NOTE: this file no longer declares a reward-weight constant. NFT weighting is
    // off-chain reward-distribution policy, not on-chain logic — nothing here or in
    // MICStaking (mining/NFTStaking.sol) ever read it. The deployed mainnet instance
    // still carries STAKING_MULTIPLIER = 250_000; it is inert, and MFPNFT must NOT be
    // redeployed to remove it — that would reset the live token supply.

    /// @notice Current max supply (starts at 2,500, can be expanded by DAO)
    uint256 public maxSupply;

    /// @notice Next token ID to mint
    uint256 public nextTokenId;

    /// @notice Whether expansion has been approved by DAO
    bool public expansionApproved;

    /// @notice Base URI for metadata
    string private _baseTokenURI;

    event MFPMinted(address indexed to, uint256 indexed tokenId);
    event MFPBatchMinted(address indexed to, uint256 startId, uint256 amount);
    event ExpansionApproved(uint256 newMaxSupply);
    event BaseURIUpdated(string newBaseURI);

    constructor(
        string memory baseURI_,
        address admin
    ) ERC721("Mission Founding Partner", "MFP") {
        require(admin != address(0), "MFP: zero admin");
        _baseTokenURI = baseURI_;
        maxSupply = INITIAL_CAP;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    // ─── Minting ───

    /// @notice Mint a single MFP-NFT
    function mint(address to) external onlyRole(MINTER_ROLE) nonReentrant returns (uint256) {
        require(to != address(0), "MFP: zero address");
        require(nextTokenId < maxSupply, "MFP: max supply reached");

        uint256 tokenId = nextTokenId++;
        _safeMint(to, tokenId);

        emit MFPMinted(to, tokenId);
        return tokenId;
    }

    /// @notice Batch mint MFP-NFTs (for SEED package bundling)
    /// @param to Recipient
    /// @param amount Number of NFTs to mint
    function mintBatch(address to, uint256 amount) external onlyRole(MINTER_ROLE) nonReentrant {
        require(to != address(0), "MFP: zero address");
        require(amount > 0, "MFP: zero amount");
        require(nextTokenId + amount <= maxSupply, "MFP: exceeds max supply");

        uint256 startId = nextTokenId;
        for (uint256 i = 0; i < amount; i++) {
            _safeMint(to, nextTokenId++);
        }

        emit MFPBatchMinted(to, startId, amount);
    }

    // ─── DAO Expansion ───

    /// @notice Approve expansion of supply by 25,000 (called after DAO vote passes)
    /// @dev Only DEFAULT_ADMIN_ROLE (DAOGovernor) can call after DAO approval
    function approveExpansion() external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!expansionApproved, "MFP: already expanded");
        expansionApproved = true;
        maxSupply = INITIAL_CAP + EXPANSION_CAP;

        emit ExpansionApproved(maxSupply);
    }

    // ─── View Functions ───

    /// @notice Total minted so far
    function totalMinted() external view returns (uint256) {
        return nextTokenId;
    }

    /// @notice Remaining mintable supply
    function remainingSupply() external view returns (uint256) {
        return maxSupply - nextTokenId;
    }

    /// @notice Check if a user holds any MFP-NFT
    function isHolder(address user) external view returns (bool) {
        return balanceOf(user) > 0;
    }

    // ─── Metadata ───

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function setBaseURI(string calldata newBaseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    // ─── Interface ───

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721Enumerable, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
