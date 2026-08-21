// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal stand-in for MICELicense, exposing only what LiquidityPoolV8's quota
///      reads. Transfers are permitted exactly as the deployed MICELicense permits them —
///      including for ACTIVE licences — because that is the behaviour the quota has to
///      survive, and a mock that forbade it would test a contract we do not have.
contract MockMiceForQuota {
    struct Info {
        address owner;
        uint256 mintTime;
        uint256 activatedAt;
        uint256 expiryTime;
        uint256 pricePaid;
    }

    mapping(uint256 => Info) public licenses;
    mapping(address => uint256[]) private _userLicenses;
    uint256 public nextId;

    function getUserLicenses(address user) external view returns (uint256[] memory) {
        return _userLicenses[user];
    }

    /// @dev NONE 0, PENDING 1, ACTIVE 2, EXPIRED 3, RECYCLED 4 — same ordering as the real one.
    function statusOf(uint256 id) public view returns (uint8) {
        Info storage l = licenses[id];
        if (l.owner == address(0)) return l.mintTime == 0 ? 0 : 4;
        if (l.activatedAt == 0) return 1;
        return block.timestamp < l.expiryTime ? 2 : 3;
    }

    function mint(address to, uint256 price) external returns (uint256 id) {
        id = nextId++;
        licenses[id] = Info(to, block.timestamp, 0, 0, price);
        _userLicenses[to].push(id);
    }

    function activate(uint256 id, uint256 term) external {
        licenses[id].activatedAt = block.timestamp;
        licenses[id].expiryTime = block.timestamp + term;
    }

    /// @notice Move a licence, active or not — mirroring MICELicense._update.
    function transferLicence(uint256 id, address to) external {
        address from = licenses[id].owner;
        licenses[id].owner = to;
        _userLicenses[to].push(id);
        uint256[] storage list = _userLicenses[from];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == id) { list[i] = list[list.length - 1]; list.pop(); break; }
        }
    }

    function recycle(uint256 id) external {
        address from = licenses[id].owner;
        licenses[id].owner = address(0);
        uint256[] storage list = _userLicenses[from];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == id) { list[i] = list[list.length - 1]; list.pop(); break; }
        }
    }
}
