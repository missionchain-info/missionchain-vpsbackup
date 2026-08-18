// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title NFTRewardPool — recurring USDT reward pool (Deck p.17)
/// @notice Reusable pool for BOTH "Weekly Growth" and "Monthly Community" rewards.
///         Every inflow is split into a Community-NFT share and a dedicated MFP share
///         (Deck p.17: Weekly = NFT 5% + MFP 0.5%; Monthly = NFT 7.5% + MFP 0.5%).
///         Admin distributes each share to off-chain-computed recipient lists whose
///         amounts already encode the NFT weighting (Builder x1 / Maker x2.5 /
///         Luminary x5 / MFP x10). The on-chain contract only ring-fences the two
///         sub-balances and moves USDT — it never picks winners.
/// @dev    Funded by RewardDistributorV2 via approve + receiveUSDT (pull pattern).
contract NFTRewardPool is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    /// @notice Off-chain system that credits each period's amounts (holders then claim).
    bytes32 public constant CREDITOR_ROLE = keccak256("CREDITOR_ROLE");
    uint256 public constant BPS_TOTAL = 10_000;

    IERC20  public immutable usdt;
    string  public poolName;      // e.g. "Weekly Growth" / "Monthly Community"
    uint256 public communityBps;  // share to Community NFT holders (remainder -> MFP)

    uint256 private _communityBalance;
    uint256 private _mfpBalance;

    /// @notice Reward credited to a holder but not yet withdrawn. Holders pull via claim().
    mapping(address => uint256) public claimable;

    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    event USDTReceived(uint256 amount, uint256 toCommunity, uint256 toMfp);
    event CommunityCredited(uint256 total, uint256 recipients);
    event MfpCredited(uint256 total, uint256 recipients);
    event RewardClaimed(address indexed holder, uint256 amount);
    event CommunityBpsUpdated(uint256 newBps);

    /// @param _usdt         USDT token (6 decimals on BSC)
    /// @param _admin        DEFAULT_ADMIN_ROLE holder (DAOGovernor / deployer)
    /// @param _poolName     Human label ("Weekly Growth" / "Monthly Community")
    /// @param _communityBps Community-NFT share in BPS. Weekly: 9091 (5/5.5).
    ///                      Monthly: 9375 (7.5/8). Remainder is the MFP share.
    constructor(address _usdt, address _admin, string memory _poolName, uint256 _communityBps) {
        require(_usdt != address(0) && _admin != address(0), "NFTRewardPool: zero addr");
        require(_communityBps <= BPS_TOTAL, "NFTRewardPool: bps > 10000");
        usdt = IERC20(_usdt);
        poolName = _poolName;
        communityBps = _communityBps;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    /// @notice Fund the pool. Splits into Community + MFP sub-balances.
    function receiveUSDT(uint256 amount) external nonReentrant onlyRole(DISTRIBUTOR_ROLE) {
        require(amount > 0, "NFTRewardPool: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        uint256 toCommunity = (amount * communityBps) / BPS_TOTAL;
        uint256 toMfp = amount - toCommunity; // remainder -> MFP (absorbs dust)
        _communityBalance += toCommunity;
        _mfpBalance += toMfp;
        emit USDTReceived(amount, toCommunity, toMfp);
    }

    /// @notice CREDIT the Community-NFT share to holders (off-chain-computed weights). Holders
    ///         then withdraw via claim(). Funds move from _communityBalance to holders' claimable.
    function creditCommunity(address[] calldata recipients, uint256[] calldata amounts)
        external nonReentrant onlyRole(CREDITOR_ROLE)
    {
        _credit(recipients, amounts, true);
    }

    /// @notice CREDIT the MFP share to MFP holders. Holders then withdraw via claim().
    function creditMFP(address[] calldata recipients, uint256[] calldata amounts)
        external nonReentrant onlyRole(CREDITOR_ROLE)
    {
        _credit(recipients, amounts, false);
    }

    /// @notice Holder withdraws their credited rewards (Community + MFP shares combined).
    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "NFTRewardPool: nothing to claim");
        claimable[msg.sender] = 0;
        usdt.safeTransfer(msg.sender, amount);
        emit RewardClaimed(msg.sender, amount);
    }

    function _credit(address[] calldata recipients, uint256[] calldata amounts, bool community) private {
        require(recipients.length == amounts.length && recipients.length > 0, "NFTRewardPool: bad input");
        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) total += amounts[i];
        if (community) {
            require(total <= _communityBalance, "NFTRewardPool: insufficient community");
            _communityBalance -= total;
        } else {
            require(total <= _mfpBalance, "NFTRewardPool: insufficient mfp");
            _mfpBalance -= total;
        }
        for (uint256 i = 0; i < recipients.length; i++) {
            if (amounts[i] > 0) claimable[recipients[i]] += amounts[i];
        }
        if (community) emit CommunityCredited(total, recipients.length);
        else emit MfpCredited(total, recipients.length);
    }

    function communityBalance() external view returns (uint256) { return _communityBalance; }
    function mfpBalance() external view returns (uint256) { return _mfpBalance; }

    /// @notice DAO may re-tune the Community/MFP split.
    function setCommunityBps(uint256 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newBps <= BPS_TOTAL, "NFTRewardPool: bps > 10000");
        communityBps = newBps;
        emit CommunityBpsUpdated(newBps);
    }

    /// @notice Recover ERC-20 tokens sent here by mistake.
    /// @dev A contract that can hold a token must be able to send it. `TreasuryManager`
    ///      v1 could not, and 105,000,000 MIC is stranded there permanently as a result.
    ///      These contracts are not upgradeable, so this cannot be added later.
    ///      USDT is excluded: it is what claimants are owed, and no admin path may reach it.
    function rescueToken(address token, address to, uint256 amount)
        external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant
    {
        require(to != address(0), "NFT: zero recipient");
        require(amount > 0,       "NFT: zero amount");
        require(token != address(usdt), "NFT: usdt has its own path");
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }
}
