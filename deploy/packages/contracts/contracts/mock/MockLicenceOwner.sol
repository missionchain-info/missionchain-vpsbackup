// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Stands in for MICELicense's ownership lookup so MiningPool can be tested on its
///      own. The real contract answers the same call from its `licenses` mapping.
contract MockLicenceOwner {
    mapping(uint256 => address) private _owner;

    function setOwner(uint256 licenseId, address who) external { _owner[licenseId] = who; }
    function ownerOfLicense(uint256 licenseId) external view returns (address) { return _owner[licenseId]; }
}
