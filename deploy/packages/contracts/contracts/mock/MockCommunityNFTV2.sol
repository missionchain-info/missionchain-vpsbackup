// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Stands in for CommunityNFTv2 so the reward pool can be tested on its own. The
///      real contract answers the same four reads; here the test decides what they say,
///      including expiry times that deliberately fall out of mint order.
contract MockCommunityNFTV2 {
    mapping(uint256 => address) private _owner;
    mapping(uint256 => uint256) private _tier;
    mapping(uint256 => uint256) private _expiry;

    uint256 public multBuilder  = 10_000; // x1.0
    uint256 public multMaker    = 25_000; // x2.5
    uint256 public multLuminary = 50_000; // x5.0

    function setToken(uint256 id, address who, uint256 tier, uint256 expiresAt_) external {
        _owner[id] = who; _tier[id] = tier; _expiry[id] = expiresAt_;
    }

    function setOwner(uint256 id, address who) external { _owner[id] = who; }

    function setMultipliers(uint256 b, uint256 m, uint256 l) external {
        multBuilder = b; multMaker = m; multLuminary = l;
    }

    function ownerOf(uint256 id) external view returns (address) { return _owner[id]; }
    function tierOf(uint256 id) external view returns (uint256) { return _tier[id]; }
    function expiresAt(uint256 id) external view returns (uint256) { return _expiry[id]; }
    function totalSerials() external pure returns (uint256) { return 0; }

    function tierMultiplier(uint256 tier) external view returns (uint256) {
        if (tier == 3) return multLuminary;
        if (tier == 2) return multMaker;
        if (tier == 1) return multBuilder;
        return 0;
    }
}
