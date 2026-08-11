// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

/// @title CommunityNFTv2 — 3-tier Community Credential NFTs (ERC-721, unique serial)
/// @notice Each minted NFT is a UNIQUE ERC-721 token whose `tokenId` is its global serial.
///         Tiers: Builder (x1.0, 60d) / Maker (x2.5, 90d) / Luminary (x5.0, 180d).
///         Artwork + serial + mint timestamp are generated 100% ON-CHAIN via tokenURI (SVG).
/// @dev    Drop-in for PreSale/ClaimRewards: keeps `mint(address,uint256) returns (uint256)`.
///         Replaces the ERC-1155 CommunityNFT (which had no per-token serial).
contract CommunityNFTv2 is ERC721Enumerable, AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // Tier ids
    uint256 public constant BUILDER  = 1;
    uint256 public constant MAKER    = 2;
    uint256 public constant LUMINARY = 3;

    // Staking multipliers — adjustable by ADMIN (basis points, 10000 = x1)
    uint256 public multBuilder  = 10_000; // x1.0
    uint256 public multMaker    = 25_000; // x2.5
    uint256 public multLuminary = 50_000; // x5.0

    // Duration per tier — DAO-adjustable
    uint256 public durationBuilder  = 60 days;
    uint256 public durationMaker    = 90 days;
    uint256 public durationLuminary = 180 days;
    uint256 public constant MIN_DURATION = 30 days;
    uint256 public constant MAX_DURATION = 720 days;

    // ─── Per-token data (tokenId == global serial) ───
    struct TokenMeta { uint8 tier; uint64 mintTime; uint64 expiryTime; }
    mapping(uint256 => TokenMeta) public meta;      // tokenId => meta
    mapping(uint256 => uint256)   public totalMinted; // tier => count
    uint256 private _nextId = 1;                     // next global serial

    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    event CommunityNFTMinted(address indexed to, uint256 indexed tokenId, uint256 tier, uint256 expiryTime);
    event MultipliersUpdated(uint256 builder, uint256 maker, uint256 luminary);
    event DurationsUpdated(uint256 builder, uint256 maker, uint256 luminary);

    constructor(address admin) ERC721("Mission Chain Community NFT", "MICNFT") {
        require(admin != address(0), "CNFT: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    // ─── Minting ───

    /// @notice Mint a unique Community NFT. tokenId = next global serial.
    /// @param to    Recipient
    /// @param tier  BUILDER(1) / MAKER(2) / LUMINARY(3)
    /// @return tokenId The minted serial
    function mint(address to, uint256 tier)
        external onlyRole(MINTER_ROLE) nonReentrant returns (uint256)
    {
        require(to != address(0), "CNFT: zero address");
        require(tier >= BUILDER && tier <= LUMINARY, "CNFT: invalid tier");

        uint256 dur = _tierDuration(tier);
        uint256 tokenId = _nextId++;
        meta[tokenId] = TokenMeta({
            tier: uint8(tier),
            mintTime: uint64(block.timestamp),
            expiryTime: uint64(block.timestamp + dur)
        });
        totalMinted[tier]++;

        _safeMint(to, tokenId);
        emit CommunityNFTMinted(to, tokenId, tier, block.timestamp + dur);
        return tokenId;
    }

    /// @notice Total number of NFTs minted so far (== highest serial).
    function totalSerials() external view returns (uint256) { return _nextId - 1; }

    // ─── Views (tier / expiry / staking) ───

    function tierOf(uint256 tokenId) external view returns (uint256) { return meta[tokenId].tier; }
    function createdAt(uint256 tokenId) external view returns (uint256) { return meta[tokenId].mintTime; }
    function expiresAt(uint256 tokenId) external view returns (uint256) { return meta[tokenId].expiryTime; }

    function isActive(uint256 tokenId) public view returns (bool) {
        TokenMeta memory m = meta[tokenId];
        return m.tier != 0 && block.timestamp < m.expiryTime;
    }

    function remainingDays(uint256 tokenId) external view returns (uint256) {
        TokenMeta memory m = meta[tokenId];
        if (m.tier == 0 || block.timestamp >= m.expiryTime) return 0;
        return (m.expiryTime - block.timestamp) / 1 days;
    }

    /// @notice Count a user's still-active NFTs of a given tier.
    function activeCountOf(address user, uint256 tier) external view returns (uint256 count) {
        uint256 bal = balanceOf(user);
        for (uint256 i = 0; i < bal; i++) {
            uint256 id = tokenOfOwnerByIndex(user, i);
            TokenMeta memory m = meta[id];
            if (m.tier == tier && block.timestamp < m.expiryTime) count++;
        }
    }

    /// @notice Highest active tier a user holds (0=None,1,2,3) — for staking multiplier.
    function highestActiveTier(address user) external view returns (uint256 highest) {
        uint256 bal = balanceOf(user);
        for (uint256 i = 0; i < bal; i++) {
            uint256 id = tokenOfOwnerByIndex(user, i);
            TokenMeta memory m = meta[id];
            if (block.timestamp < m.expiryTime && m.tier > highest) highest = m.tier;
        }
    }

    function tierMultiplier(uint256 tier) public view returns (uint256) {
        if (tier == LUMINARY) return multLuminary;
        if (tier == MAKER)    return multMaker;
        if (tier == BUILDER)  return multBuilder;
        return 5000; // x0.5 for None
    }

    function tierDuration(uint256 tier) external view returns (uint256) { return _tierDuration(tier); }

    function tierName(uint256 tier) public pure returns (string memory) {
        if (tier == BUILDER)  return "Builder";
        if (tier == MAKER)    return "Maker";
        if (tier == LUMINARY) return "Luminary";
        return "None";
    }

    function _tierUpper(uint8 tier) internal pure returns (string memory) {
        if (tier == 1) return "BUILDER";
        if (tier == 2) return "MAKER";
        return "LUMINARY";
    }

    // ─── Admin ───

    function setMultipliers(uint256 builder, uint256 maker, uint256 luminary)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(builder >= 5000 && builder <= 20000, "CNFT: builder 0.5x-2x");
        require(maker >= 10000 && maker <= 50000, "CNFT: maker 1x-5x");
        require(luminary >= 20000 && luminary <= 100000, "CNFT: luminary 2x-10x");
        require(builder < maker && maker < luminary, "CNFT: must be ascending");
        multBuilder = builder; multMaker = maker; multLuminary = luminary;
        emit MultipliersUpdated(builder, maker, luminary);
    }

    function setDurations(uint256 builder, uint256 maker, uint256 luminary)
        external onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(builder >= MIN_DURATION && builder <= MAX_DURATION, "CNFT: builder range");
        require(maker >= MIN_DURATION && maker <= MAX_DURATION, "CNFT: maker range");
        require(luminary >= MIN_DURATION && luminary <= MAX_DURATION, "CNFT: luminary range");
        require(builder < maker && maker < luminary, "CNFT: must be ascending");
        durationBuilder = builder; durationMaker = maker; durationLuminary = luminary;
        emit DurationsUpdated(builder, maker, luminary);
    }

    // ─── On-chain metadata (JSON + SVG) ───

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        TokenMeta memory m = meta[tokenId];
        string memory name = tierName(m.tier);
        string memory img = Base64.encode(bytes(_svgImage(tokenId, m)));
        string memory json = string.concat(
            '{"name":"', name, ' #', tokenId.toString(),
            ' - Mission Chain Community NFT",',
            '"description":"Mission Chain Community NFT, ', name,
            ' tier. Born of Faith. Built for People.",',
            '"image":"data:image/svg+xml;base64,', img, '",',
            '"attributes":[',
                '{"trait_type":"Tier","value":"', name, '"},',
                '{"trait_type":"Serial","value":', tokenId.toString(), '},',
                '{"trait_type":"Tier Weight","value":"x', _boostStr(tierMultiplier(m.tier)), '"},',
                '{"trait_type":"Status","value":"', block.timestamp >= m.expiryTime ? "Expired" : "Active", '"},',
                '{"trait_type":"Duration (days)","value":', (_tierDuration(m.tier) / 1 days).toString(), '},',
                '{"display_type":"date","trait_type":"Created","value":', uint256(m.mintTime).toString(), '},',
                '{"display_type":"date","trait_type":"Expires","value":', uint256(m.expiryTime).toString(), '}',
            ']}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @dev Card artwork — 900x1350, generated fully on-chain. Ported from the official
    ///      Mission Chain Community NFT card design (`Community NFT/` kit) on 2026-08-03.
    ///      An expired credential is stamped EXPIRED and dimmed: benefits end at `expiryTime`,
    ///      but the token is deliberately NOT burned — it stays as proof of participation.
    function _svgImage(uint256 tokenId, TokenMeta memory m) internal view returns (string memory) {
        Pal memory p = _pal(m.tier);
        return string.concat(
            _svgHead(p),
            _svgFrame(p, m.tier),
            _svgIdentity(p, tokenId, m),
            _svgStats(p, m),
            block.timestamp >= m.expiryTime ? _svgExpired() : "",
            "</svg>"
        );
    }

    struct Pal {
        string a; string b; string accent; string soft; string metal; string glow; string eyebrow;
    }

    function _pal(uint8 tier) internal pure returns (Pal memory) {
        if (tier == 1) return Pal("#08242e", "#0f414c", "#63d9c4", "#b6ece2", "#d5a36b", "#2ab9a6", "FOUNDATION TIER");
        if (tier == 2) return Pal("#180b25", "#40184e", "#f1d176", "#f5e8bd", "#cda64a", "#c070d2", "MOMENTUM TIER");
        return Pal("#071a36", "#164b83", "#ffd876", "#fff0bb", "#e2b64c", "#6fa8e7", "LEGACY TIER");
    }

    function _svgHead(Pal memory p) private pure returns (string memory) {
        return string.concat(
            '<svg viewBox="0 0 900 1350" xmlns="http://www.w3.org/2000/svg"><defs>',
            '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="', p.b,
            '"/><stop offset=".52" stop-color="', p.a, '"/><stop offset="1" stop-color="#03070d"/></linearGradient>',
            '<linearGradient id="mt" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff2c6"/><stop offset=".35" stop-color="', p.metal,
            '"/><stop offset=".65" stop-color="#8f6335"/><stop offset="1" stop-color="#f5d998"/></linearGradient>',
            '<radialGradient id="ha"><stop stop-color="', p.glow, '" stop-opacity=".6"/><stop offset=".58" stop-color="', p.glow,
            '" stop-opacity=".12"/><stop offset="1" stop-color="', p.glow, '" stop-opacity="0"/></radialGradient>',
            '<filter id="gl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="13" result="b"/>',
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>'
        );
    }

    function _svgFrame(Pal memory p, uint8 tier) private pure returns (string memory) {
        return string.concat(
            '<rect x="15" y="15" width="870" height="1320" rx="64" fill="#03060b"/>',
            '<rect x="24" y="24" width="852" height="1302" rx="58" fill="url(#bg)" stroke="url(#mt)" stroke-width="8"/>',
            '<rect x="47" y="47" width="806" height="1256" rx="42" fill="none" stroke="', p.metal, '" stroke-opacity=".48" stroke-width="2"/>',
            '<g fill="none" stroke="', p.accent, '" stroke-width="3" opacity=".8"><path d="M68 106V80Q68 68 80 68h26"/>',
            '<path d="M794 68h26q12 0 12 12v26"/><path d="M68 1244v26q0 12 12 12h26"/><path d="M794 1282h26q12 0 12-12v-26"/></g>',
            '<text x="450" y="112" text-anchor="middle" fill="#fff4da" font-family="Georgia,serif" font-size="43" font-weight="700" letter-spacing="11">MISSION CHAIN</text>',
            '<text x="450" y="154" text-anchor="middle" fill="', p.soft, '" font-family="Arial,sans-serif" font-size="17" font-weight="700" letter-spacing="8">COMMUNITY NFT</text>',
            '<text x="450" y="194" text-anchor="middle" fill="', p.accent, '" font-family="Arial,sans-serif" font-size="12" font-weight="700" letter-spacing="5">', p.eyebrow, '</text>',
            '<circle cx="450" cy="360" r="205" fill="url(#ha)"/><circle cx="450" cy="360" r="151" fill="#030b14" fill-opacity=".72" stroke="', p.accent, '" stroke-width="6"/>',
            '<g filter="url(#gl)">', _emblem(tier, p.accent), '</g>'
        );
    }

    function _svgIdentity(Pal memory p, uint256 tokenId, TokenMeta memory m) private pure returns (string memory) {
        return string.concat(
            '<text x="450" y="614" text-anchor="middle" fill="#fff4dc" font-family="Georgia,serif" font-size="82" font-weight="700" letter-spacing="4">', _tierUpper(m.tier), '</text>',
            '<line x1="245" y1="657" x2="655" y2="657" stroke="', p.metal, '" stroke-opacity=".55"/>',
            '<rect x="258" y="690" width="384" height="82" rx="41" fill="#040a12" fill-opacity=".72" stroke="', p.metal, '" stroke-width="2"/>',
            '<text x="450" y="742" text-anchor="middle" fill="', p.accent, '" font-family="Courier New,monospace" font-size="29" font-weight="700" letter-spacing="5">SERIAL &#8226; MC-', _pad4(tokenId), '</text>',
            '<text x="450" y="824" text-anchor="middle" fill="', p.soft, '" font-family="Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="4">MINING VALIDITY</text>',
            '<text x="360" y="865" text-anchor="end" fill="#fff4dc" font-family="Courier New,monospace" font-size="23" font-weight="700">', _ymd(m.mintTime), '</text>',
            '<path d="M390 856h120" stroke="', p.metal, '" stroke-opacity=".65" stroke-width="2"/>',
            '<text x="540" y="865" fill="#fff4dc" font-family="Courier New,monospace" font-size="23" font-weight="700">', _ymd(m.expiryTime), '</text>',
            '<line x1="196" y1="925" x2="704" y2="925" stroke="', p.metal, '" stroke-opacity=".42" stroke-width="2"/>'
        );
    }

    function _svgStats(Pal memory p, TokenMeta memory m) private view returns (string memory) {
        return string.concat(
            '<text x="310" y="1012" text-anchor="middle" fill="#fff4dc" font-family="Georgia,serif" font-size="55" font-weight="700">', (_tierDuration(m.tier) / 1 days).toString(), ' DAYS</text>',
            '<text x="310" y="1050" text-anchor="middle" fill="', p.soft, '" font-family="Arial,sans-serif" font-size="16" font-weight="700" letter-spacing="4">DURATION</text>',
            '<line x1="450" y1="966" x2="450" y2="1060" stroke="', p.metal, '" stroke-opacity=".35"/>',
            '<text x="590" y="1012" text-anchor="middle" fill="#fff4dc" font-family="Georgia,serif" font-size="59" font-weight="700">&#215;', _boostStr(tierMultiplier(m.tier)), '</text>',
            '<text x="590" y="1050" text-anchor="middle" fill="', p.soft, '" font-family="Arial,sans-serif" font-size="16" font-weight="700" letter-spacing="4">TIER WEIGHT</text>',
            '<rect x="160" y="1110" width="580" height="70" rx="18" fill="#02070d" fill-opacity=".5" stroke="', p.accent, '" stroke-opacity=".25"/>',
            '<text x="450" y="1142" text-anchor="middle" fill="', p.soft, '" font-family="Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="2">PROOF OF PARTICIPATION &#8226; ON-CHAIN IDENTITY</text>',
            '<text x="450" y="1166" text-anchor="middle" fill="', p.accent, '" font-family="Courier New,monospace" font-size="11" letter-spacing="3">MISSIONCHAIN COMMUNITY PROTOCOL</text>',
            '<text x="450" y="1260" text-anchor="middle" fill="', p.soft, '" font-family="Georgia,serif" font-size="20" font-style="italic" font-weight="700">Born of Faith. Built for People.</text>'
        );
    }

    /// @dev Dim the card and stamp EXPIRED once the credential's validity has elapsed.
    function _svgExpired() private pure returns (string memory) {
        return string.concat(
            '<rect x="24" y="24" width="852" height="1302" rx="58" fill="#03060b" fill-opacity=".62"/>',
            '<g transform="rotate(-13 450 690)"><rect x="132" y="626" width="636" height="128" rx="14" fill="#4a0d16" fill-opacity=".92" stroke="#ff9aa6" stroke-width="5"/>',
            '<text x="450" y="716" text-anchor="middle" fill="#ffe1e6" font-family="Georgia,serif" font-size="86" font-weight="700" letter-spacing="14">EXPIRED</text></g>'
        );
    }

    /// @dev Tier emblem inside the medallion (900x1350 coordinate space).
    function _emblem(uint8 tier, string memory accent) internal pure returns (string memory) {
        if (tier == 1) { // Builder — stacked foundation blocks
            return string.concat(
                '<g fill="none" stroke="', accent, '" stroke-width="12" stroke-linejoin="round">',
                '<rect x="350" y="426" width="200" height="70" rx="13"/>',
                '<rect x="380" y="345" width="140" height="62" rx="13"/>',
                '<rect x="414" y="275" width="72" height="52" rx="12"/></g>'
            );
        }
        if (tier == 2) { // Maker — ascending chevrons
            return string.concat(
                '<g fill="none" stroke="', accent, '" stroke-width="13" stroke-linecap="round" stroke-linejoin="round">',
                '<path d="M360 424 450 362 540 424"/><path d="M372 351 450 295 528 351"/>',
                '<path d="M392 282 450 235 508 282"/></g>'
            );
        }
        // Luminary — radiant star
        return string.concat(
            '<g><path d="m450 245 27 82 87 1-70 51 26 83-70-50-70 50 26-83-70-51 87-1Z" fill="', accent, '"/>',
            '<circle cx="450" cy="354" r="15" fill="#fff6d3"/>',
            '<circle cx="450" cy="354" r="134" fill="none" stroke="', accent, '" stroke-opacity=".35" stroke-width="2" stroke-dasharray="8 15"/></g>'
        );
    }

    /// @dev "2026.07.20" — matches the printed card's validity format.
    function _ymd(uint256 ts) internal pure returns (string memory) {
        (uint256 y, uint256 mo, uint256 d) = _daysToDate(ts / 86400);
        return string.concat(y.toString(), ".", _two(mo), ".", _two(d));
    }

    // ─── Formatting helpers ───

    /// @dev "x1.0" / "x2.5" from basis points (one decimal).
    function _boostStr(uint256 bps) internal pure returns (string memory) {
        return string.concat((bps / 10000).toString(), ".", ((bps % 10000) / 1000).toString());
    }

    /// @dev Zero-pad a serial to at least 4 digits.
    function _pad4(uint256 v) internal pure returns (string memory) {
        string memory s = v.toString();
        uint256 len = bytes(s).length;
        if (len >= 4) return s;
        string memory zeros = "";
        for (uint256 i = 0; i < 4 - len; i++) zeros = string.concat(zeros, "0");
        return string.concat(zeros, s);
    }

    function _two(uint256 v) internal pure returns (string memory) {
        return v < 10 ? string.concat("0", v.toString()) : v.toString();
    }

    /// @dev Format a unix timestamp (UTC) as "DDMMYY - HHMMSS".
    function _dateStr(uint256 ts) internal pure returns (string memory) {
        uint256 secs = ts % 86400;
        (uint256 y, uint256 mo, uint256 d) = _daysToDate(ts / 86400);
        return string.concat(
            _two(d), _two(mo), _two(y % 100), " - ",
            _two(secs / 3600), _two((secs % 3600) / 60), _two(secs % 60)
        );
    }

    /// @dev Unix day count -> (year, month, day). BokkyPooBah date algorithm.
    function _daysToDate(uint256 _days) internal pure returns (uint256 year, uint256 month, uint256 day) {
        int256 L = int256(_days) + 68569 + 2440588;
        int256 N = (4 * L) / 146097;
        L = L - (146097 * N + 3) / 4;
        int256 y = (4000 * (L + 1)) / 1461001;
        L = L - (1461 * y) / 4 + 31;
        int256 mo = (80 * L) / 2447;
        int256 d = L - (2447 * mo) / 80;
        L = mo / 11;
        mo = mo + 2 - 12 * L;
        y = 100 * (N - 49) + y + L;
        year = uint256(y);
        month = uint256(mo);
        day = uint256(d);
    }

    function _tierDuration(uint256 tier) internal view returns (uint256) {
        if (tier == LUMINARY) return durationLuminary;
        if (tier == MAKER)    return durationMaker;
        if (tier == BUILDER)  return durationBuilder;
        revert("CNFT: invalid tier");
    }

    // ─── Required overrides (ERC721Enumerable + AccessControl) ───

    function _update(address to, uint256 tokenId, address auth)
        internal override(ERC721Enumerable) returns (address)
    {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value)
        internal override(ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721Enumerable, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @notice Recover ERC-20 tokens sent here by mistake.
    /// @dev A contract that can hold a token must be able to send it. `TreasuryManager`
    ///      v1 could not, and 105,000,000 MIC is stranded there permanently as a result.
    ///      These contracts are not upgradeable, so this cannot be added later.
    ///      This contract holds no ERC-20 by design, so anything that arrives is a stray deposit.
    function rescueToken(address token, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant
    {
        require(to != address(0), "COM: zero recipient");
        require(amount > 0,       "COM: zero amount");
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }
}
