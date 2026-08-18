// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Mint Community NFT credential at a milestone.
interface ICommunityNFT {
    function mint(address to, uint256 tier) external returns (uint256);
}

/// @title ClaimRewardsV2 — Community Growth Award + Milestones & Incentives
/// @notice Receives 10.5% of GROSS revenue (4200 BPS of the 25% Marketing bucket) and
///         manages 2 internal layers. Referral (F1/F2) is NOT here — it is paid instantly
///         upstream in PreSale. Supersedes ClaimRewards (which also held a Referral Reserve).
///
///         Layer 1 — Community Growth Award / GV Override (9% of gross · 8571 BPS internal):
///           Differential GV bonus on downline group volume. Admin distributes monthly to
///           leaders with off-chain-computed amounts (rate diff x downline monthly sales).
///
///         Layer 2 — Milestones & Incentives (1.5% of gross · 1429 BPS internal):
///           Discretionary fund for market developers — paid IN KIND (travel, gifts, etc.),
///           allocated at the Board of Management's discretion. Community NFT credentials
///           (Builder/Maker/Luminary) may also be minted at sales milestones.
contract ClaimRewardsV2 is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    /// @notice Granted to ReferralRegistry (and any source of overflow into the M&I pool).
    bytes32 public constant OVERFLOW_ROLE = keccak256("OVERFLOW_ROLE");
    /// @notice Granted to the off-chain system that credits monthly GV amounts (users then claim).
    bytes32 public constant CREDITOR_ROLE = keccak256("CREDITOR_ROLE");

    IERC20        public immutable usdt;
    ICommunityNFT public immutable communityNFT;

    uint256 public constant BPS_TOTAL = 10_000;
    /// @notice GV Override: 9 / 10.5 * 10000 = 8571 (remainder -> Milestones & Incentives).
    uint256 public constant BPS_GV = 8571;

    uint256 private _gvBalance; // Layer 1 — uncredited GV funds
    uint256 private _miBalance; // Layer 2 (Milestones & Incentives)

    /// @notice GV credited to a leader but not yet withdrawn. Leaders pull via claimGV().
    mapping(address => uint256) public gvClaimable;

    /// @notice Community NFT tier minted at each milestone, per White Paper §E.6.1.A:
    ///         3 qualifying F1 -> Builder, 5 -> Maker, 10 -> Luminary (count-based, and the
    ///         counter resets so the cycle repeats). Eligibility is evaluated off-chain by
    ///         the reward engine; this contract only mints on an approved instruction.
    uint256[3] private MILESTONE_NFT_TIERS = [1, 2, 3];

    /// @notice Largest batch mintRankBonus() will issue in one call, so a mistyped
    ///         quantity cannot mint thousands of NFTs or run out of gas mid-loop.
    uint256 public constant MAX_RANK_BONUS_BATCH = 20;

    event USDTReceived(uint256 amount, uint256 toGV, uint256 toMilestones);
    event GVCredited(uint256 total, uint256 leaders);
    event GVClaimed(address indexed leader, uint256 amount);
    event MilestonesIncentivesDistributed(uint256 total, uint256 recipients);
    event MilestoneNFTMinted(address indexed user, uint256 tier, uint256 tokenId);

    /// @notice One-time Community NFT bonus for reaching a Community Growth Award rank
    ///         (White Paper §B.5.1). Distinct from MilestoneNFTMinted so the two
    ///         programmes stay separable in the audit trail.
    event RankBonusNFTMinted(address indexed user, uint256 tier, uint256 quantity, uint256 firstTokenId);
    event OverflowReceived(uint256 amount);
    event GVSweptToMI(uint256 amount);

    constructor(address _usdt, address _communityNFT, address _admin) {
        require(_usdt != address(0), "CRv2: zero addr");
        require(_communityNFT != address(0), "CRv2: zero addr");
        require(_admin != address(0), "CRv2: zero addr");
        usdt = IERC20(_usdt);
        communityNFT = ICommunityNFT(_communityNFT);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    /// @notice Called by RewardDistributorV2 (DISTRIBUTOR_ROLE). Splits into GV + M&I.
    function receiveUSDT(uint256 amount) external nonReentrant onlyRole(DISTRIBUTOR_ROLE) {
        require(amount > 0, "CRv2: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        uint256 toGV = (amount * BPS_GV) / BPS_TOTAL;
        uint256 toMi = amount - toGV; // remainder -> Milestones & Incentives (absorbs dust)
        _gvBalance += toGV;
        _miBalance += toMi;
        emit USDTReceived(amount, toGV, toMi);
    }

    /// @notice Receive UNSPENT referral (from ReferralRegistry) into the Milestones &
    ///         Incentives pool. This is why effective M&I > its 1.5% base.
    function receiveOverflow(uint256 amount) external nonReentrant onlyRole(OVERFLOW_ROLE) {
        require(amount > 0, "CRv2: zero amount");
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        _miBalance += amount;
        emit OverflowReceived(amount);
    }

    /// @notice Move UNSPENT GV (leaders below the 9% tier) from the GV pool into the
    ///         Milestones & Incentives pool. Called by admin after each monthly GV run.
    function sweepGVToMI(uint256 amount) external onlyRole(CREDITOR_ROLE) {
        require(amount <= _gvBalance, "CRv2: insufficient GV");
        _gvBalance -= amount;
        _miBalance += amount;
        emit GVSweptToMI(amount);
    }

    /// @notice Layer 1 — CREDIT the monthly Community Growth Award to leaders. The off-chain
    ///         system computes each leader's differential GV amount and credits it here; leaders
    ///         then withdraw themselves via claimGV(). Funds are moved from _gvBalance to the
    ///         leaders' claimable balances (they stay in this contract until claimed).
    function creditGV(address[] calldata leaders, uint256[] calldata amounts)
        external nonReentrant onlyRole(CREDITOR_ROLE)
    {
        uint256 total = _sumAndCheck(leaders, amounts, _gvBalance);
        _gvBalance -= total;
        for (uint256 i = 0; i < leaders.length; i++) {
            if (amounts[i] > 0) gvClaimable[leaders[i]] += amounts[i];
        }
        emit GVCredited(total, leaders.length);
    }

    /// @notice A leader withdraws their credited Community Growth Award.
    function claimGV() external nonReentrant {
        uint256 amount = gvClaimable[msg.sender];
        require(amount > 0, "CRv2: nothing to claim");
        gvClaimable[msg.sender] = 0;
        usdt.safeTransfer(msg.sender, amount);
        emit GVClaimed(msg.sender, amount);
    }

    /// @notice Layer 2 — Board of Management directs the Milestones & Incentives fund.
    ///         Recipients are typically an ops/treasury wallet that funds in-kind rewards
    ///         (travel, gifts) or the beneficiaries directly.
    function distributeMilestonesIncentives(address[] calldata recipients, uint256[] calldata amounts)
        external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE)
    {
        uint256 total = _sumAndCheck(recipients, amounts, _miBalance);
        _miBalance -= total;
        for (uint256 i = 0; i < recipients.length; i++) {
            if (amounts[i] > 0) usdt.safeTransfer(recipients[i], amounts[i]);
        }
        emit MilestonesIncentivesDistributed(total, recipients.length);
    }

    /// @notice Mint a Community NFT credential to a market developer at a sales milestone.
    /// @param milestoneIndex 0 = Builder ($2,500) / 1 = Maker ($5,000) / 2 = Luminary ($10,000)
    function mintMilestoneNFT(address user, uint256 milestoneIndex)
        external nonReentrant onlyRole(CREDITOR_ROLE)
    {
        require(user != address(0), "CRv2: zero addr");
        require(milestoneIndex < 3, "CRv2: bad milestone");
        uint256 tier = MILESTONE_NFT_TIERS[milestoneIndex];
        uint256 tokenId = communityNFT.mint(user, tier);
        emit MilestoneNFTMinted(user, tier, tokenId);
    }

    /// @notice Mint the one-time Community NFT bonus for a Community Growth Award rank.
    ///         White Paper §B.5.1 awards these in batches — Builder 3×Builder, Connector
    ///         3×Maker, Champion 3×Luminary, Ambassador 5×Luminary, Legend 10×Luminary —
    ///         so this issues `quantity` at once rather than forcing N separate calls.
    /// @dev Rank eligibility is computed off-chain by the reward engine and approved before
    ///      this is called; the contract does not track ranks. Emits a distinct event from
    ///      the milestone programme so the two never blur together in the ledger.
    /// @param user     Recipient.
    /// @param tier     BUILDER(1) / MAKER(2) / LUMINARY(3) — validated by CommunityNFTv2.
    /// @param quantity How many to mint, 1..MAX_RANK_BONUS_BATCH.
    function mintRankBonus(address user, uint256 tier, uint256 quantity)
        external nonReentrant onlyRole(CREDITOR_ROLE)
    {
        require(user != address(0), "CRv2: zero addr");
        require(quantity > 0 && quantity <= MAX_RANK_BONUS_BATCH, "CRv2: bad quantity");

        uint256 firstTokenId = communityNFT.mint(user, tier);
        for (uint256 i = 1; i < quantity; i++) {
            communityNFT.mint(user, tier);
        }
        emit RankBonusNFTMinted(user, tier, quantity, firstTokenId);
    }

    function _sumAndCheck(address[] calldata r, uint256[] calldata a, uint256 bal)
        private pure returns (uint256 total)
    {
        require(r.length == a.length && r.length > 0, "CRv2: bad input");
        for (uint256 i = 0; i < a.length; i++) total += a[i];
        require(total <= bal, "CRv2: insufficient balance");
    }

    function gvBalance() external view returns (uint256) { return _gvBalance; }
    function miBalance() external view returns (uint256) { return _miBalance; }
}
