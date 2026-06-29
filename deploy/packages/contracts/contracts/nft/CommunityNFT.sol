// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @title CommunityNFT — 3-tier Community Credential NFTs
/// @notice ERC-1155 with auto-expiry staking:
///         Builder  (×1 multiplier, 60 days)
///         Maker    (×2.5 multiplier, 90 days)
///         Luminary (×5 multiplier, 180 days)
/// @dev Each minted NFT tracks its own expiry. Expired NFTs stop earning staking rewards.
contract CommunityNFT is ERC1155, AccessControl, ReentrancyGuard {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // Token IDs
    uint256 public constant BUILDER  = 1;
    uint256 public constant MAKER    = 2;
    uint256 public constant LUMINARY = 3;

    // Staking multipliers — adjustable by ADMIN (basis points, 10000 = ×1)
    uint256 public multBuilder  = 10_000;  // ×1 default
    uint256 public multMaker    = 25_000;  // ×2.5 default
    uint256 public multLuminary = 50_000;  // ×5 default

    // Duration per tier — DAO-adjustable, initialized to default values
    uint256 public durationBuilder  = 60 days;
    uint256 public durationMaker    = 90 days;
    uint256 public durationLuminary = 180 days;

    uint256 public constant MIN_DURATION = 30 days;
    uint256 public constant MAX_DURATION = 720 days;

    // ─── Per-NFT Expiry Tracking ───

    /// @notice Individual NFT instance with expiry
    struct NFTInstance {
        uint256 tier;        // BUILDER / MAKER / LUMINARY
        uint256 mintTime;
        uint256 expiryTime;
        address owner;
        bool active;
    }

    /// @notice All minted instances
    mapping(uint256 => NFTInstance) public instances;
    uint256 public totalInstances;

    /// @notice User → list of instance IDs
    mapping(address => uint256[]) public userInstances;

    /// @notice Supply tracking per tier
    mapping(uint256 => uint256) public totalMinted;
    mapping(uint256 => uint256) public activeCount;

    /// @notice Base URI for metadata
    string private _baseURI;

    event CommunityNFTMinted(address indexed to, uint256 indexed instanceId, uint256 tier, uint256 expiryTime);
    event CommunityNFTExpired(uint256 indexed instanceId, uint256 tier);
    event BaseURIUpdated(string newBaseURI);
    event MultipliersUpdated(uint256 builder, uint256 maker, uint256 luminary);
    event DurationsUpdated(uint256 builder, uint256 maker, uint256 luminary);

    constructor(
        string memory baseURI_,
        address admin
    ) ERC1155(baseURI_) {
        require(admin != address(0), "CNFT: zero admin");
        _baseURI = baseURI_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    // ─── Minting ───

    /// @notice Mint a Community NFT with auto-expiry
    /// @param to Recipient
    /// @param tier BUILDER(1), MAKER(2), or LUMINARY(3)
    function mint(address to, uint256 tier) external onlyRole(MINTER_ROLE) nonReentrant returns (uint256) {
        require(to != address(0), "CNFT: zero address");
        require(tier >= BUILDER && tier <= LUMINARY, "CNFT: invalid tier");

        uint256 duration = _tierDuration(tier);
        uint256 instanceId = totalInstances++;

        instances[instanceId] = NFTInstance({
            tier: tier,
            mintTime: block.timestamp,
            expiryTime: block.timestamp + duration,
            owner: to,
            active: true
        });

        userInstances[to].push(instanceId);
        totalMinted[tier]++;
        activeCount[tier]++;

        _mint(to, tier, 1, "");

        emit CommunityNFTMinted(to, instanceId, tier, block.timestamp + duration);
        return instanceId;
    }

    /// @notice Batch mint same tier to one address
    function mintBatch(
        address to,
        uint256 tier,
        uint256 amount
    ) external onlyRole(MINTER_ROLE) nonReentrant {
        require(to != address(0), "CNFT: zero address");
        require(tier >= BUILDER && tier <= LUMINARY, "CNFT: invalid tier");
        require(amount > 0, "CNFT: zero amount");

        uint256 duration = _tierDuration(tier);

        for (uint256 i = 0; i < amount; i++) {
            uint256 instanceId = totalInstances++;
            instances[instanceId] = NFTInstance({
                tier: tier,
                mintTime: block.timestamp,
                expiryTime: block.timestamp + duration,
                owner: to,
                active: true
            });
            userInstances[to].push(instanceId);

            emit CommunityNFTMinted(to, instanceId, tier, block.timestamp + duration);
        }

        totalMinted[tier] += amount;
        activeCount[tier] += amount;
        _mint(to, tier, amount, "");
    }

    // ─── Expiry Management ───

    /// @notice Mark expired instances as inactive (callable by anyone)
    /// @param instanceIds Array of instance IDs to check
    function expireInstances(uint256[] calldata instanceIds) external {
        for (uint256 i = 0; i < instanceIds.length; i++) {
            NFTInstance storage inst = instances[instanceIds[i]];
            if (inst.active && block.timestamp >= inst.expiryTime) {
                inst.active = false;
                activeCount[inst.tier]--;
                emit CommunityNFTExpired(instanceIds[i], inst.tier);
            }
        }
    }

    // ─── View Functions ───

    /// @notice Check if a specific instance is still active
    function isActive(uint256 instanceId) public view returns (bool) {
        NFTInstance storage inst = instances[instanceId];
        return inst.active && block.timestamp < inst.expiryTime;
    }

    /// @notice Get remaining days for an instance
    function remainingDays(uint256 instanceId) external view returns (uint256) {
        NFTInstance storage inst = instances[instanceId];
        if (!inst.active || block.timestamp >= inst.expiryTime) return 0;
        return (inst.expiryTime - block.timestamp) / 1 days;
    }

    /// @notice Get user's active instances with details
    function getUserInstances(address user) external view returns (uint256[] memory) {
        return userInstances[user];
    }

    /// @notice Count active NFTs per tier for a user
    function activeCountOf(address user, uint256 tier) external view returns (uint256 count) {
        uint256[] storage ids = userInstances[user];
        for (uint256 i = 0; i < ids.length; i++) {
            NFTInstance storage inst = instances[ids[i]];
            if (inst.tier == tier && inst.active && block.timestamp < inst.expiryTime) {
                count++;
            }
        }
    }

    /// @notice Get highest active tier for a user (for staking multiplier)
    /// @return 0=None, 1=Builder, 2=Maker, 3=Luminary
    function highestActiveTier(address user) external view returns (uint256) {
        uint256[] storage ids = userInstances[user];
        uint256 highest = 0;
        for (uint256 i = 0; i < ids.length; i++) {
            NFTInstance storage inst = instances[ids[i]];
            if (inst.active && block.timestamp < inst.expiryTime && inst.tier > highest) {
                highest = inst.tier;
            }
        }
        return highest;
    }

    /// @notice Get multiplier for a tier (basis points)
    function tierMultiplier(uint256 tier) external view returns (uint256) {
        if (tier == LUMINARY) return multLuminary;
        if (tier == MAKER) return multMaker;
        if (tier == BUILDER) return multBuilder;
        return 5000; // ×0.5 for No-NFT
    }

    /// @notice Get tier duration
    function tierDuration(uint256 tier) external view returns (uint256) {
        return _tierDuration(tier);
    }

    /// @notice Get tier name
    function tierName(uint256 tier) external pure returns (string memory) {
        if (tier == BUILDER) return "Builder";
        if (tier == MAKER) return "Maker";
        if (tier == LUMINARY) return "Luminary";
        return "None";
    }

    // ─── Metadata ───

    function uri(uint256 id) public view override returns (string memory) {
        require(id >= BUILDER && id <= LUMINARY, "CNFT: invalid tier");
        return string(abi.encodePacked(_baseURI, id.toString(), ".json"));
    }

    function setBaseURI(string calldata newBaseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _baseURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    /// @notice Adjust tier multipliers
    /// @param builder Builder multiplier (BPS, e.g., 10000 = ×1)
    /// @param maker Maker multiplier (BPS)
    /// @param luminary Luminary multiplier (BPS)
    function setMultipliers(
        uint256 builder,
        uint256 maker,
        uint256 luminary
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(builder >= 5000 && builder <= 20000, "CNFT: builder 0.5x-2x");
        require(maker >= 10000 && maker <= 50000, "CNFT: maker 1x-5x");
        require(luminary >= 20000 && luminary <= 100000, "CNFT: luminary 2x-10x");
        require(builder < maker && maker < luminary, "CNFT: must be ascending");

        multBuilder = builder;
        multMaker = maker;
        multLuminary = luminary;

        emit MultipliersUpdated(builder, maker, luminary);
    }

    /// @notice Adjust tier durations (DAO-adjustable)
    /// @param builder Builder duration in seconds (30–720 days)
    /// @param maker Maker duration in seconds (30–720 days)
    /// @param luminary Luminary duration in seconds (30–720 days)
    /// @dev Must be strictly ascending: builder < maker < luminary
    function setDurations(
        uint256 builder,
        uint256 maker,
        uint256 luminary
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(builder >= MIN_DURATION && builder <= MAX_DURATION, "CNFT: builder out of range");
        require(maker >= MIN_DURATION && maker <= MAX_DURATION,    "CNFT: maker out of range");
        require(luminary >= MIN_DURATION && luminary <= MAX_DURATION, "CNFT: luminary out of range");
        require(builder < maker && maker < luminary, "CNFT: must be ascending");

        durationBuilder  = builder;
        durationMaker    = maker;
        durationLuminary = luminary;

        emit DurationsUpdated(builder, maker, luminary);
    }

    // ─── Internal ───

    function _tierDuration(uint256 tier) internal view returns (uint256) {
        if (tier == LUMINARY) return durationLuminary;
        if (tier == MAKER) return durationMaker;
        if (tier == BUILDER) return durationBuilder;
        revert("CNFT: invalid tier");
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC1155, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
