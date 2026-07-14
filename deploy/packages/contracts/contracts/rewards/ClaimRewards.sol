// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal interface to mint CommunityNFT from ClaimRewards
interface ICommunityNFT {
    function mint(address to, uint256 tier) external returns (uint256);
}

/// @dev Minimal interface to read GV tier from ReferralRegistry
interface IReferralRegistry {
    function getTier(address user) external view returns (uint256);
    function getGVRate(address user) external view returns (uint256);
    function monthlyGV(address user, uint256 monthIndex) external view returns (uint256);
}

/// @title ClaimRewards — Referral Reserve + Milestone + GV Override
/// @notice Receives 61.43% (6143 BPS) of the marketing pool from RewardDistributor.
///         Manages 3 reward layers internally:
///
///         Layer 1 — Referral Reserve (4651 BPS of 10000):
///           Accumulates USDT for referral top-up. Admin distributes to specific addresses.
///
///         Layer 2 — Milestone Bonus (1163 BPS of 10000):
///           Sales milestones: $2,500 / $5,000 / $10,000 cumulative cycles.
///           At each milestone: 5% cash bonus (USDT) + CommunityNFT mint.
///
///         Layer 3 — GV Override (4186 BPS of 10000):
///           GV Bonus paid as override on downline sales.
///           Admin triggers monthly GV distribution to leaders.
///
/// @dev Internal BPS ratios (sum = 10000):
///      Referral Reserve:  10 / 21.5 * 10000 ≈ 4651
///      Milestone:          2.5 / 21.5 * 10000 ≈ 1163
///      GV Override:         9 / 21.5 * 10000 ≈ 4186
///      (4651 + 1163 + 4186 = 10000)
contract ClaimRewards is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────
    // Roles
    // ─────────────────────────────────────────────────────────

    /// @notice Role for the RewardDistributor contract to call receiveUSDT.
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");

    // ─────────────────────────────────────────────────────────
    // State — addresses
    // ─────────────────────────────────────────────────────────

    /// @notice USDT token (6 decimals on BSC)
    IERC20 public immutable usdt;

    /// @notice CommunityNFT — minted to users at milestone trigger
    ICommunityNFT public immutable communityNFT;

    /// @notice ReferralRegistry — GV tier lookups
    IReferralRegistry public immutable referralRegistry;

    // ─────────────────────────────────────────────────────────
    // State — internal pool balances
    // ─────────────────────────────────────────────────────────

    /// @notice Layer 1: Referral Reserve pool balance (USDT 6-decimal)
    uint256 private _reserveBalance;

    /// @notice Layer 2: Milestone Bonus pool balance (USDT 6-decimal)
    uint256 private _milestoneBalance;

    /// @notice Layer 3: GV Override pool balance (USDT 6-decimal)
    uint256 private _gvBalance;

    // ─────────────────────────────────────────────────────────
    // Constants — internal BPS split
    // ─────────────────────────────────────────────────────────

    uint256 public constant BPS_TOTAL     = 10_000;

    /// @notice Referral Reserve: 10 / 21.5 * 10000 ≈ 4651
    uint256 public constant BPS_RESERVE   = 4651;

    /// @notice Milestone Bonus: 2.5 / 21.5 * 10000 ≈ 1163
    uint256 public constant BPS_MILESTONE = 1163;

    /// @notice GV Override: remainder after reserve + milestone (absorbs rounding dust)
    /// Effective: 4186 BPS

    // ─────────────────────────────────────────────────────────
    // Constants — milestone config
    // ─────────────────────────────────────────────────────────

    /// @notice Milestone cycle amounts (USDT 6-decimal): $2,500 / $5,000 / $10,000
    uint256[3] private MILESTONE_AMOUNTS = [
        2_500 * 1e6,   // index 0 — $2,500
        5_000 * 1e6,   // index 1 — $5,000
        10_000 * 1e6   // index 2 — $10,000
    ];

    /// @notice Bonus rate: 5% of milestone amount
    uint256 public constant MILESTONE_BONUS_BPS = 500; // 5%

    /// @notice CommunityNFT tier minted at each milestone index
    ///         Index 0 ($2,500): Builder (tier 1)
    ///         Index 1 ($5,000): Maker (tier 2)
    ///         Index 2 ($10,000): Luminary (tier 3)
    uint256[3] private MILESTONE_NFT_TIERS = [1, 2, 3];

    // ─────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────

    /// @notice Emitted when USDT is received and split into 3 pools
    event USDTReceived(
        uint256 totalAmount,
        uint256 toReserve,
        uint256 toMilestone,
        uint256 toGV
    );

    /// @notice Emitted when reserve funds are distributed to addresses
    event ReserveDistributed(uint256 totalAmount);

    /// @notice Emitted when a milestone is triggered for a user
    event MilestoneTriggered(address indexed user, uint256 indexed milestoneIndex, uint256 bonusAmount);

    /// @notice Emitted when GV override funds are distributed to leaders
    event GVDistributed(uint256 totalAmount);

    // ─────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────

    /// @param _usdt             USDT token address (6 decimals)
    /// @param _communityNFT     CommunityNFT contract (MINTER_ROLE must be granted to this contract)
    /// @param _referralRegistry ReferralRegistry contract for GV tier lookups
    /// @param _admin            DEFAULT_ADMIN_ROLE holder (DAOGovernor)
    constructor(
        address _usdt,
        address _communityNFT,
        address _referralRegistry,
        address _admin
    ) {
        require(_usdt             != address(0), "ClaimRewards: zero address");
        require(_communityNFT     != address(0), "ClaimRewards: zero address");
        require(_referralRegistry != address(0), "ClaimRewards: zero address");
        require(_admin            != address(0), "ClaimRewards: zero address");

        usdt             = IERC20(_usdt);
        communityNFT     = ICommunityNFT(_communityNFT);
        referralRegistry = IReferralRegistry(_referralRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // ─────────────────────────────────────────────────────────
    // Layer 0 — Receive & Split
    // ─────────────────────────────────────────────────────────

    /// @notice Called by RewardDistributor (DISTRIBUTOR_ROLE).
    ///         Pulls `amount` USDT from caller and splits into 3 internal pools.
    ///         GV pool absorbs any rounding dust.
    /// @param  amount  USDT amount (6 decimals)
    function receiveUSDT(uint256 amount) external nonReentrant onlyRole(DISTRIBUTOR_ROLE) {
        require(amount > 0, "ClaimRewards: zero amount");

        // Pull USDT from caller (caller must have approved this contract)
        usdt.safeTransferFrom(msg.sender, address(this), amount);

        // Split into 3 pools — GV absorbs rounding dust
        uint256 toReserve   = (amount * BPS_RESERVE)   / BPS_TOTAL;
        uint256 toMilestone = (amount * BPS_MILESTONE) / BPS_TOTAL;
        uint256 toGV        = amount - toReserve - toMilestone;

        _reserveBalance   += toReserve;
        _milestoneBalance += toMilestone;
        _gvBalance        += toGV;

        emit USDTReceived(amount, toReserve, toMilestone, toGV);
    }

    // ─────────────────────────────────────────────────────────
    // Layer 1 — Referral Reserve
    // ─────────────────────────────────────────────────────────

    /// @notice Admin distributes from the Referral Reserve to specific addresses.
    ///         Used as top-up when the referral fund runs low.
    /// @param  recipients  Array of recipient addresses
    /// @param  amounts     USDT amounts (6 decimals) corresponding to each recipient
    function distributeReserve(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        require(recipients.length > 0, "ClaimRewards: empty arrays");
        require(recipients.length == amounts.length, "ClaimRewards: length mismatch");

        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
        require(total <= _reserveBalance, "ClaimRewards: insufficient reserve balance");

        _reserveBalance -= total;

        for (uint256 i = 0; i < recipients.length; i++) {
            if (amounts[i] > 0) {
                usdt.safeTransfer(recipients[i], amounts[i]);
            }
        }

        emit ReserveDistributed(total);
    }

    // ─────────────────────────────────────────────────────────
    // Layer 2 — Milestone Bonus
    // ─────────────────────────────────────────────────────────

    /// @notice Admin triggers milestone reward for a user.
    ///         Pays 5% cash bonus (USDT) from milestoneBalance and mints a CommunityNFT.
    ///         Milestones are repeating cycles ($10K → reset → $2.5K again).
    /// @param  user            Recipient of the milestone bonus
    /// @param  milestoneIndex  0 = $2,500 cycle / 1 = $5,000 cycle / 2 = $10,000 cycle
    function triggerMilestone(
        address user,
        uint256 milestoneIndex
    ) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        require(user != address(0), "ClaimRewards: zero address");
        require(milestoneIndex < 3, "ClaimRewards: invalid milestone index");

        uint256 milestoneAmount = MILESTONE_AMOUNTS[milestoneIndex];
        uint256 bonus = (milestoneAmount * MILESTONE_BONUS_BPS) / BPS_TOTAL;

        require(bonus <= _milestoneBalance, "ClaimRewards: insufficient milestone balance");

        _milestoneBalance -= bonus;

        // Pay USDT bonus
        usdt.safeTransfer(user, bonus);

        // Mint CommunityNFT for the milestone tier
        uint256 nftTier = MILESTONE_NFT_TIERS[milestoneIndex];
        communityNFT.mint(user, nftTier);

        emit MilestoneTriggered(user, milestoneIndex, bonus);
    }

    // ─────────────────────────────────────────────────────────
    // Layer 3 — GV Override
    // ─────────────────────────────────────────────────────────

    /// @notice Admin distributes GV Override rewards to leaders.
    ///         Called monthly. Amounts are pre-calculated off-chain using:
    ///         override = (yourRate - downlineRate) × downline's monthlySales
    ///         Rates from ReferralRegistry.getGVRate(): 0/300/500/700/800/900 BPS.
    /// @param  leaders  Array of leader addresses
    /// @param  amounts  USDT GV override amounts (6 decimals) per leader
    function distributeGVOverride(
        address[] calldata leaders,
        uint256[] calldata amounts
    ) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        require(leaders.length > 0, "ClaimRewards: empty arrays");
        require(leaders.length == amounts.length, "ClaimRewards: length mismatch");

        uint256 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            total += amounts[i];
        }
        require(total <= _gvBalance, "ClaimRewards: insufficient GV balance");

        _gvBalance -= total;

        for (uint256 i = 0; i < leaders.length; i++) {
            if (amounts[i] > 0) {
                usdt.safeTransfer(leaders[i], amounts[i]);
            }
        }

        emit GVDistributed(total);
    }

    // ─────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────

    /// @notice Current Referral Reserve pool balance (USDT 6-decimal)
    function reserveBalance() external view returns (uint256) {
        return _reserveBalance;
    }

    /// @notice Current Milestone Bonus pool balance (USDT 6-decimal)
    function milestoneBalance() external view returns (uint256) {
        return _milestoneBalance;
    }

    /// @notice Current GV Override pool balance (USDT 6-decimal)
    function gvBalance() external view returns (uint256) {
        return _gvBalance;
    }
}
