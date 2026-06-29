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

    /// @notice Initial max supply — 25,000
    uint256 public constant INITIAL_CAP = 25_000;

    /// @notice Maximum possible expansion (requires DAO vote) — additional 25,000
    uint256 public constant EXPANSION_CAP = 25_000;

    /// @notice Staking multiplier (basis points, 10000 = ×1)
    uint256 public constant STAKING_MULTIPLIER = 100_000; // ×10

    /// @notice Current max supply (starts at 25,000, can be expanded by DAO)
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
