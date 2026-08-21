// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockMICELicense — Test stub for IMICELicenseReader
/// @notice Used in EmissionController tests to control activeLicenses count
contract MockMICELicense {
    uint256 public activeLicenses;

    function setActiveLicenses(uint256 count) external {
        activeLicenses = count;
    }

    // ── Licence records, for LiquidityPoolV8's sell quota ──
    //
    // Field order matches MICELicense.LicenseInfo exactly, because V8 reads the tuple
    // positionally through the auto-generated `licenses` getter. A mock that reorders
    // them would pass its own tests and fail against the real contract.

    struct LicenseInfo {
        address owner;
        uint256 mintTime;
        uint256 activatedAt;
        uint256 expiryTime;
        uint256 pricePaid;
    }

    mapping(uint256 => LicenseInfo) public licenses;
    mapping(address => uint256[]) private _userLicenses;

    function mintTo(uint256 licenceId, address owner_, uint256 expiryTime) external {
        licenses[licenceId] = LicenseInfo({
            owner:       owner_,
            mintTime:    block.timestamp,
            activatedAt: block.timestamp,
            expiryTime:  expiryTime,
            pricePaid:   100 ether
        });
        _userLicenses[owner_].push(licenceId);
    }

    /// @notice Move a licence, the way a real transfer would. The pool must keep metering
    ///         the licence, not the wallet — this is what lets a test prove that.
    function transferLicence(uint256 licenceId, address to) external {
        address from = licenses[licenceId].owner;
        licenses[licenceId].owner = to;

        uint256[] storage list = _userLicenses[from];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == licenceId) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
        _userLicenses[to].push(licenceId);
    }

    function expire(uint256 licenceId) external {
        licenses[licenceId].expiryTime = block.timestamp;
    }

    function isActive(uint256 licenceId) external view returns (bool) {
        LicenseInfo memory l = licenses[licenceId];
        return l.activatedAt != 0 && block.timestamp < l.expiryTime;
    }

    function getUserLicenses(address user) external view returns (uint256[] memory) {
        return _userLicenses[user];
    }
}
