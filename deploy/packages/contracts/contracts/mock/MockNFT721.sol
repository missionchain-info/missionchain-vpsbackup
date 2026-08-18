// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

/// @dev Stands in for `CommunityNFTv2`: a plain ERC-721 with **no** ERC-2981.
///
///      This is the case that matters. `royaltyInfo` on the real CommunityNFTv2 reverts —
///      verified on chain 2026-08-12 — so an escrow that calls it unguarded makes every
///      Community NFT trade impossible. A mock that implemented royalties would have let
///      that bug through the whole suite.
contract MockNFT721 is ERC721 {
    constructor() ERC721("Mock Plain NFT", "MPN") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

/// @dev Stands in for `MFPNFT`: ERC-721 **with** ERC-2981. The live MFPNFT pays 5% to the
///      Owner wallet; the rate here is settable so the royalty cap can be tested against a
///      collection that asks for more than the escrow is willing to forward.
contract MockNFT721Royalty is ERC721, IERC2981 {
    address public royaltyReceiver;
    uint96 public royaltyBps;

    constructor(address receiver, uint96 bps) ERC721("Mock Royalty NFT", "MRN") {
        royaltyReceiver = receiver;
        royaltyBps = bps;
    }

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function setRoyalty(address receiver, uint96 bps) external {
        royaltyReceiver = receiver;
        royaltyBps = bps;
    }

    function royaltyInfo(uint256, uint256 salePrice)
        external
        view
        override
        returns (address, uint256)
    {
        return (royaltyReceiver, (salePrice * royaltyBps) / 10_000);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, IERC165)
        returns (bool)
    {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }
}

/// @dev A collection that claims ERC-2981 and then reverts when asked. Real collections do
///      this — a proxy mid-upgrade, a bad implementation — and a trade must not become
///      impossible because of a fault in someone else's contract.
contract MockNFT721BadRoyalty is ERC721 {
    constructor() ERC721("Mock Bad Royalty", "MBR") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }

    function royaltyInfo(uint256, uint256) external pure returns (address, uint256) {
        revert("royalty oracle down");
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }
}

/// @dev Not an ERC-721 at all. The constructor guard must refuse it.
contract MockNotAnNFT {
    function supportsInterface(bytes4) external pure returns (bool) {
        return false;
    }
}
