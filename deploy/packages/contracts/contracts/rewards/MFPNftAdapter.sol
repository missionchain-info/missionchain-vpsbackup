// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC721Min {
    function ownerOf(uint256 tokenId) external view returns (address);
    function totalSupply() external view returns (uint256);
}

/// @title MFPNftAdapter — lets NftRewardPoolV2 run the MFP pool in NFT mode
///
/// @notice `NftRewardPoolV2` has two mutually exclusive modes. With `nft` unset it is a
///         FLAT-WEIGHT pool where only an admin may write weight, through `setWeight`. With
///         `nft` set it is an NFT pool where `enroll` and `resync` are **permissionless**.
///
///         The MFP pool was deployed flat, which put the operator between every buyer and
///         their rewards: weight does not follow an ERC-721 transfer, and no one but an
///         admin could correct it. Moving to NFT mode hands that back — a holder enrols
///         their own pass, and a buyer forces `resync` themselves.
///
///         The obstacle is only that `NftRewardPoolV2` asks an NFT for a tier, a multiplier
///         and an expiry, and MFPNFT carries none of them. This supplies them.
///
/// @dev WHY CONSTANTS ARE THE RIGHT ANSWER, NOT A SHORTCUT
///
///      Mission Founding Passes are undifferentiated: capped at 2,500, no tier, no term.
///      Within its own pool the weight is shared pro-rata, so the multiplier only has to be
///      equal across tokens — its absolute value cancels. It is NOT comparable to the
///      Community pool's Builder/Maker/Luminary weights; the pools are funded separately
///      and never mix.
///
///      Read-only. Holds no funds, has no admin, and has no setter — the collection it
///      speaks for is fixed at construction, so it cannot later be pointed elsewhere.
contract MFPNftAdapter {
    /// @notice The collection this speaks for. Immutable by design.
    IERC721Min public immutable mfp;

    /// @notice The single tier every MFP-NFT belongs to.
    uint256 public constant TIER = 1;

    /// @notice Weight per pass, in the pool's 1e4 scale. Equal for every pass, so the value
    ///         sets the unit and nothing else. 10000 reads as "one share", matching the
    ///         Community pool's Builder.
    uint256 public constant WEIGHT = 10_000;

    /// @notice MFP passes do not expire. The pool still needs a horizon because it orders
    ///         its expiry heap by one and stores it as a `uint64`, so `type(uint256).max`
    ///         would truncate to a value in the past and retire every pass on the first
    ///         sync. 2100-01-01 is far beyond any horizon this system plans for and fits.
    uint256 public constant NEVER = 4_102_444_800;

    constructor(address _mfp) {
        require(_mfp != address(0), "MFPAdapter: zero nft");
        mfp = IERC721Min(_mfp);
    }

    /// @notice Forwarded — the one fact only MFPNFT holds, and the one `enroll` credits.
    /// @dev Reverts for a token never minted, exactly as the pool expects.
    function ownerOf(uint256 tokenId) external view returns (address) {
        return mfp.ownerOf(tokenId);
    }

    function tierOf(uint256) external pure returns (uint256) {
        return TIER;
    }

    function tierMultiplier(uint256) external pure returns (uint256) {
        return WEIGHT;
    }

    function expiresAt(uint256) external pure returns (uint256) {
        return NEVER;
    }

    /// @notice Forwarded. Read for display only.
    function totalSerials() external view returns (uint256) {
        return mfp.totalSupply();
    }
}
