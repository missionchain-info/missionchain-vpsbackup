// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev The mint path. `ClaimRewardsV2.mintRankBonus` is reached with CREDITOR_ROLE and
///      emits `RankBonusNFTMinted`, so going through it keeps one audit trail for the
///      programme instead of two.
interface IClaimRewardsV2 {
    function mintRankBonus(address user, uint256 tier, uint256 quantity) external;
}

/// @title RankBonusClaim — the member mints their own Community Growth Award batch
/// @notice A member who reaches a rank is shown the award in the DApp and presses Mint.
///         The NFTs go to their wallet, paid for with their own gas.
///
/// @dev ## Why this contract exists
///
/// The award was minted by an admin typing a wallet address into the console. That works,
/// but it makes an automatic entitlement look like a favour, it puts the gas and the
/// timing on the operator, and a mistyped address mints an irreversible batch to a
/// stranger. Owner decision 2026-08-12: reaching a rank shows the member a button.
///
/// The admin button stays, and stays useful — it is now unambiguously for awards **outside**
/// the KPI programme, which is a different act and deserves a different door.
///
/// ## What is on chain and what is not
///
/// Rank is group volume over a referral tree. It is computed off chain because it has to
/// be: the tree and the sales ledger are indexed, not stored in a contract. So this
/// contract does not decide who qualifies — an `AWARDER` records that they did, and the
/// member claims it.
///
/// That split is the honest one, and it is stated rather than hidden: an award here is a
/// statement by the platform's keeper, not a proof the chain can check. What the contract
/// **does** guarantee is the part that actually needs guaranteeing — that an award is
/// minted **once**, to the wallet it was granted to, in the quantity the rank table says.
///
/// ## No decimals guard here, on purpose
///
/// Every other contract in this batch checks `IERC20Metadata(usdt).decimals() == 18` in its
/// constructor, because the 18-vs-6 mistake has cost this codebase seven incidents. This
/// one prices nothing in dollars and holds no USDT, so such a check would assert something
/// it never relies on — a green light with nothing behind it, which is worse than none.
/// `rescueToken` below is the only ERC-20 surface, and it moves whatever arrives by
/// mistake without interpreting it. If a USD-denominated threshold is ever added here, the
/// guard goes in with it, and the contract goes into `DecimalsGuard.test.ts` that day.
contract RankBonusClaim is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant VERSION = "RankBonusClaim-v1.0.0";

    /// @notice Held by the reward-engine keeper. Records that a wallet reached a rank.
    bytes32 public constant AWARDER_ROLE = keccak256("AWARDER_ROLE");

    /// @notice Community Growth Award ranks, White Paper §B.5.1.
    ///         Believer earns no NFT batch, so it is not a member of this enum.
    enum Rank { NONE, BUILDER, CONNECTOR, CHAMPION, AMBASSADOR, LEGEND }
    uint256 public constant RANK_COUNT = 6;

    /// @notice Community NFT tiers, matching CommunityNFTv2.
    uint256 public constant TIER_BUILDER  = 1;
    uint256 public constant TIER_MAKER    = 2;
    uint256 public constant TIER_LUMINARY = 3;

    /// @notice What a rank mints. Settable, because a published table is a business
    ///         decision the DAO may revise — and because writing it as a `constant` is
    ///         exactly what forced a redeploy of the P2P escrow.
    struct Award {
        uint256 tier;
        uint256 quantity;
    }
    mapping(Rank => Award) public awardForRank;

    /// @notice Hard fence on the table. `ClaimRewardsV2.MAX_RANK_BONUS_BATCH` is 20, so a
    ///         larger number here would only revert downstream, further from the mistake.
    uint256 public constant MAX_QUANTITY = 20;

    IClaimRewardsV2 public immutable claimRewards;

    /// @notice Ranks a wallet has been awarded and not yet minted.
    mapping(address => mapping(Rank => bool)) public awarded;

    /// @notice Ranks a wallet has already minted. Separate from `awarded` on purpose: this
    ///         one is never cleared, so re-awarding a rank cannot re-open a claim that was
    ///         already paid.
    mapping(address => mapping(Rank => bool)) public claimed;

    bool public paused;

    event RankAwarded(address indexed user, Rank indexed rank, address indexed by);
    event RankAwardRevoked(address indexed user, Rank indexed rank, address indexed by);
    event RankBonusClaimed(address indexed user, Rank indexed rank, uint256 tier, uint256 quantity);
    event AwardTableUpdated(Rank indexed rank, uint256 tier, uint256 quantity);
    event PausedSet(bool paused);
    event TokenRescued(address indexed token, address indexed to, uint256 amount);

    constructor(address _claimRewards, address _admin) {
        require(_claimRewards != address(0), "RBC: zero claimRewards");
        require(_admin != address(0), "RBC: zero admin");
        claimRewards = IClaimRewardsV2(_claimRewards);
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);

        // White Paper §B.5.1. Champion, Ambassador and Legend all mint Luminary, so the
        // rank is identified by the (tier, quantity) pair rather than by tier alone.
        awardForRank[Rank.BUILDER]    = Award(TIER_BUILDER,  3);
        awardForRank[Rank.CONNECTOR]  = Award(TIER_MAKER,    3);
        awardForRank[Rank.CHAMPION]   = Award(TIER_LUMINARY, 3);
        awardForRank[Rank.AMBASSADOR] = Award(TIER_LUMINARY, 5);
        awardForRank[Rank.LEGEND]     = Award(TIER_LUMINARY, 10);
    }

    modifier notPaused() {
        require(!paused, "RBC: paused");
        _;
    }

    // ─── Keeper records eligibility ──────────────────────────────────────────

    /// @notice Record that `user` reached `rank`. Mints nothing.
    /// @dev Idempotent: awarding a rank a wallet already holds or has already minted is a
    ///      no-op rather than a revert, so a keeper that re-runs a batch after a crash does
    ///      not fail the whole transaction on rows it already wrote.
    function award(address user, Rank rank) public onlyRole(AWARDER_ROLE) {
        require(user != address(0), "RBC: zero user");
        require(rank != Rank.NONE && uint256(rank) < RANK_COUNT, "RBC: bad rank");
        if (claimed[user][rank] || awarded[user][rank]) return;
        awarded[user][rank] = true;
        emit RankAwarded(user, rank, msg.sender);
    }

    /// @notice Award many at once. Same idempotence.
    function awardBatch(address[] calldata users, Rank[] calldata ranks) external onlyRole(AWARDER_ROLE) {
        require(users.length == ranks.length && users.length > 0, "RBC: bad input");
        for (uint256 i = 0; i < users.length; i++) award(users[i], ranks[i]);
    }

    /// @notice Withdraw an award that has not been minted yet.
    /// @dev Only the admin, not the keeper: a compromised keeper key should be able to
    ///      grant too much, which is visible and correctable, rather than quietly strip
    ///      awards members have earned.
    function revokeAward(address user, Rank rank) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(awarded[user][rank], "RBC: nothing to revoke");
        awarded[user][rank] = false;
        emit RankAwardRevoked(user, rank, msg.sender);
    }

    // ─── Member claims ───────────────────────────────────────────────────────

    /// @notice Mint the batch for a rank you have been awarded, to your own wallet.
    /// @dev No parameters beyond the rank, and no recipient: the NFTs go to `msg.sender`.
    ///      A claim function that accepted a destination would be a way to talk somebody
    ///      into signing their award away.
    function claim(Rank rank) external nonReentrant notPaused {
        require(awarded[msg.sender][rank], "RBC: not awarded");
        require(!claimed[msg.sender][rank], "RBC: already claimed");

        Award memory a = awardForRank[rank];
        require(a.quantity > 0, "RBC: rank mints nothing");

        // Written before the external call, so a re-entrant claim finds it already spent.
        // `nonReentrant` covers this too; the ordering does not depend on it.
        claimed[msg.sender][rank] = true;
        awarded[msg.sender][rank] = false;

        claimRewards.mintRankBonus(msg.sender, a.tier, a.quantity);

        emit RankBonusClaimed(msg.sender, rank, a.tier, a.quantity);
    }

    // ─── Views the DApp uses ─────────────────────────────────────────────────

    /// @notice Every rank this wallet can mint right now, and what each one pays.
    /// @dev Returned as fixed-length arrays with a count, so the DApp needs one call to
    ///      draw the whole panel rather than one per rank.
    function claimableOf(address user)
        external
        view
        returns (Rank[] memory ranks, uint256[] memory tiers, uint256[] memory quantities)
    {
        uint256 n;
        for (uint256 r = 1; r < RANK_COUNT; r++) {
            if (awarded[user][Rank(r)] && !claimed[user][Rank(r)]) n++;
        }
        ranks = new Rank[](n);
        tiers = new uint256[](n);
        quantities = new uint256[](n);
        uint256 i;
        for (uint256 r = 1; r < RANK_COUNT; r++) {
            if (awarded[user][Rank(r)] && !claimed[user][Rank(r)]) {
                Award memory a = awardForRank[Rank(r)];
                ranks[i] = Rank(r);
                tiers[i] = a.tier;
                quantities[i] = a.quantity;
                i++;
            }
        }
    }

    /// @notice The published rank table, for the DApp and for anyone checking the docs.
    function awardTable() external view returns (uint256[] memory tiers, uint256[] memory quantities) {
        tiers = new uint256[](RANK_COUNT);
        quantities = new uint256[](RANK_COUNT);
        for (uint256 r = 0; r < RANK_COUNT; r++) {
            Award memory a = awardForRank[Rank(r)];
            tiers[r] = a.tier;
            quantities[r] = a.quantity;
        }
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    /// @notice Change what a rank mints. Affects claims made after this call; batches
    ///         already minted are untouched.
    function setAward(Rank rank, uint256 tier, uint256 quantity) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(rank != Rank.NONE && uint256(rank) < RANK_COUNT, "RBC: bad rank");
        require(tier >= TIER_BUILDER && tier <= TIER_LUMINARY, "RBC: bad tier");
        require(quantity > 0 && quantity <= MAX_QUANTITY, "RBC: bad quantity");
        awardForRank[rank] = Award(tier, quantity);
        emit AwardTableUpdated(rank, tier, quantity);
    }

    /// @notice Stop claiming. Awards already recorded stay recorded and can be claimed
    ///         when this is lifted — a pause must never erase what a member earned.
    function setPaused(bool p) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Recover ERC-20 sent here by mistake.
    /// @dev A contract that can hold a token must be able to send it. `TreasuryManager v1`
    ///      could not, and 105,000,000 MIC is stranded there permanently. This contract
    ///      holds no ERC-20 by design, so anything that arrives is a stray.
    function rescueToken(address token, address to, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        require(to != address(0), "RBC: zero recipient");
        require(amount > 0, "RBC: zero amount");
        IERC20(token).safeTransfer(to, amount);
        emit TokenRescued(token, to, amount);
    }
}
