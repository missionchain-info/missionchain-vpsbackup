// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILockManagerCV {
    function createSchedule(
        address beneficiary,
        uint256 amount,
        uint256 cliffDuration,
        uint256 cliffUnlockBps,
        uint256 monthlyUnlockBps
    ) external;
}

/// @title ChurchesVault — grants to churches, ministries and Christian community bodies
/// @notice
/// Funded by 10% of the DAO's mining slice, forwarded automatically by
/// `TreasuryManagerV2` as each day's emission arrives. Holding it here rather than in a
/// ledger inside the treasury keeps the money visibly ring-fenced: anyone can read this
/// address and see exactly what the community programme holds, without trusting an
/// internal accounting variable.
///
/// Grants leave the vault and vest at the recipient — the `FoundersVault` pattern. The
/// transfer and the `LockManager` schedule happen in one call, so the published
/// 24-month cliff cannot be skipped by an operator in a hurry.
///
/// Every balance has an exit. `TreasuryManager` v1 immobilised 105,000,000 MIC by
/// holding a token it had no function to send; nothing here can repeat that.
///
/// @dev Production `admin` is DAOGovernor or a Gnosis Safe, never an EOA.
contract ChurchesVault is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GRANTOR_ROLE = keccak256("GRANTOR_ROLE");

    /// 24-month cliff, 10% at cliff, then 2.5% monthly (~60 months total).
    uint256 public constant CLIFF_DURATION   = 730 days;
    uint256 public constant CLIFF_UNLOCK_BPS = 1000;
    uint256 public constant MONTHLY_BPS      = 250;

    IERC20 public immutable mic;
    ILockManagerCV public lockManager;

    uint256 public totalGranted;
    uint256 public grantCount;
    mapping(address => uint256) public grantedTo;

    struct Grant {
        address recipient;
        uint256 amount;
        string  purpose;
        uint64  grantedAt;
        address grantedBy;
    }
    /// @notice Full history, kept on-chain so the programme is auditable without an indexer.
    Grant[] public grants;

    event GrantIssued(uint256 indexed id, address indexed to, uint256 amount, string purpose);
    event LockManagerSet(address indexed oldManager, address indexed newManager);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    constructor(address _mic, address _lockManager, address admin) {
        require(_mic != address(0),   "CV: zero mic");
        require(admin != address(0),  "CV: zero admin");
        mic = IERC20(_mic);
        lockManager = ILockManagerCV(_lockManager);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GRANTOR_ROLE, admin);
    }

    /// @notice MIC available to grant. Read from the balance directly — there is no
    ///         separate ledger to drift out of step with reality.
    function available() public view returns (uint256) {
        return mic.balanceOf(address(this));
    }

    /// @notice Issue a grant. MIC leaves the vault and vests at the recipient.
    /// @param to      Church, ministry or community body wallet
    /// @param amount  MIC amount (18 decimals)
    /// @param purpose Recorded on-chain for audit
    function grant(address to, uint256 amount, string calldata purpose)
        external onlyRole(GRANTOR_ROLE) nonReentrant returns (uint256 id)
    {
        require(to != address(0), "CV: zero recipient");
        require(amount > 0,       "CV: zero amount");
        require(amount <= available(), "CV: insufficient balance");
        require(address(lockManager) != address(0), "CV: lockManager not set");

        id = grants.length;
        grants.push(Grant({
            recipient: to, amount: amount, purpose: purpose,
            grantedAt: uint64(block.timestamp), grantedBy: msg.sender
        }));
        totalGranted += amount;
        grantCount += 1;
        grantedTo[to] += amount;

        mic.safeTransfer(to, amount);
        lockManager.createSchedule(to, amount, CLIFF_DURATION, CLIFF_UNLOCK_BPS, MONTHLY_BPS);

        emit GrantIssued(id, to, amount, purpose);
    }

    function getGrant(uint256 id) external view returns (Grant memory) {
        require(id < grants.length, "CV: bad id");
        return grants[id];
    }

    function setLockManager(address _lockManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_lockManager != address(0), "CV: zero lockManager");
        emit LockManagerSet(address(lockManager), _lockManager);
        lockManager = ILockManagerCV(_lockManager);
    }

    /// @notice Recover a token sent here by mistake. MIC is excluded on purpose — MIC
    ///         arriving here is the programme's funding, and its way out is `grant`,
    ///         which carries the vesting schedule. An unvested MIC exit would be a
    ///         hole straight through the 24-month cliff.
    function rescueToken(address token, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant
    {
        require(token != address(mic), "CV: use grant() for MIC");
        require(to != address(0),      "CV: zero recipient");
        require(amount > 0,            "CV: zero amount");
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }
}
