// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockMICELicense — Test stub for IMICELicenseReader
/// @notice Used in EmissionController tests to control activeLicenses count
contract MockMICELicense {
    uint256 public activeLicenses;

    function setActiveLicenses(uint256 count) external {
        activeLicenses = count;
    }
}
