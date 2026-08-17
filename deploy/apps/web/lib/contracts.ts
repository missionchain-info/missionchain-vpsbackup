// Mission Chain contract addresses for the DApp.
//
// Every value is derived from `@missionchain/sdk` — this file keeps NO addresses of its
// own. It used to hold a hand-maintained copy, which is how `seed` sat on SeedSaleV7
// after V7 was halted: two lists, one of them silently stale. There is now one list, and
// updating the SDK after a deploy updates the app with it.

import { USDT_DECIMALS, getActiveAddresses } from '@missionchain/sdk'

const A = getActiveAddresses()

const ZERO = '0x0000000000000000000000000000000000000000'

/** wagmi/viem want the 0x-prefixed template type; the SDK stores plain strings. */
type Hex = `0x${string}`
const hex = (a: string) => a as Hex

/** Prefer the newer contract, fall back to the one it replaces while it is still zero. */
const pick = (...candidates: string[]) => hex(candidates.find(a => a && a !== ZERO) ?? ZERO)

export const CONTRACTS = {
  // Tokens & Vesting
  usdt: hex(A.USDT),
  mic: hex(A.MICToken),
  micToken: hex(A.MICToken),            // alias used by Header.tsx
  lockManager: hex(A.LockManager),
  vesting: hex(A.LockManager),          // @deprecated alias → lockManager
  referral: hex(A.ReferralRegistry),

  // NFTs — CommunityNFTv2 (ERC-721) supersedes the ERC-1155 original
  mfpNft: hex(A.MFPNFT),
  communityNft: pick(A.CommunityNFTv2, A.CommunityNFT),

  // Sales — SeedSaleV9 only. Deliberately NO fallback to V8 or V7: V7 was halted for
  // 6-decimal pricing, V8 shipped without a whitelist and would sell MIC at half the
  // Pre-Sale price to anyone. A fallback chain would quietly point the DApp at whichever
  // of them still had an address, which is exactly how `seed` sat on the halted V7.
  seed: hex(A.SeedSaleV9),
  presale: hex(A.PreSale),
  airdrop: hex(A.AirdropDistributor),
  mice: hex(A.MICELicense),

  // Mining & Staking
  mining: hex(A.MiningPool),
  staking: hex(A.NFTStaking),
  emission: hex(A.EmissionController),

  // Revenue routing
  revenueRouter: hex(A.RevenueRouter),
  seedBudget: hex(A.SeedBudgetV5c),
  operationalSalaryPool: hex(A.OperationalSalaryPoolV3),
  managementBonusPool: hex(A.ManagementBonusPoolV3),
  reservedExpensesPool: hex(A.ReservedExpensesPoolV3),
  rewardDistributor: pick(A.RewardDistributorV2, A.RewardDistributor),

  // Reward sub-pools
  claimRewards: pick(A.ClaimRewardsV2, A.ClaimRewards),
  weeklyRewardPool: hex(A.NFTRewardPoolWeekly),
  monthlyRewardPool: hex(A.NFTRewardPoolMonthly),
  listingReserve: hex(A.ListingReserve),
  periodicRewards: hex(A.PeriodicRewards),
  luckyDraw: hex(A.LuckyDraw),
  incentivePool: hex(A.IncentivePool),

  // Infrastructure
  daoGovernor: hex(A.DAOGovernor),
  managementPool: hex(A.ManagementPool),
  treasuryManager: hex(A.TreasuryManager),
  liquidityPool: pick(A.LiquidityPool, A.LiquidityPoolV5),
  // The SWAP pool deployed 2026-08-10. Kept separate from `liquidityPool`, which still
  // names the older contract other pages read — conflating them would point the swap UI
  // at a pool that has no swap.
  /**
   * The public SWAP pool. V7 replaced V6 on 2026-08-17 because V6 charged every buyer
   * 2.006× its own quoted spot price. Read this, not `liquidityPoolV6`.
   */
  swapPool: hex((A as any).LiquidityPoolV7),
  /**
   * ⛔ NOT PUBLIC. Held in reserve, admin console only. Its 49,999,900 MIC can never be
   * withdrawn or burned, so it stays as a standing offer at ~$0.02 until V7's effective
   * price reaches that level. Anything showing its price MUST derive it from `quoteBuy`;
   * `spotPrice` reads $0.01 while the pool charges $0.02.
   */
  liquidityPoolV6: hex(A.LiquidityPoolV6),
  foundersVault: hex(A.FoundersVault),
  // The NFT escrows, both P2PEscrowNFT, live 2026-08-12. `p2pEscrowMFP` keeps its name so
  // callers do not all have to change, but it points at the new contract — the one it
  // named could never accept an order at any real price.
  p2pEscrowMFP: hex(A.P2PEscrowNFT_MFP),
  p2pEscrowCommunity: hex(A.P2PEscrowNFT_Community),
  /** Members claim their own Community Growth Award NFTs here. */
  rankBonusClaim: hex(A.RankBonusClaim),
} as const

/** True once a contract has a real address — use this to gate UI, not a hardcoded flag. */
export const isDeployed = (addr: string) => Boolean(addr) && addr !== ZERO

// --- ABIs (minimal, only what the frontend needs) ---

export const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
] as const

export const USDT_ABI = [
  ...ERC20_ABI,
  { type: 'function', name: 'faucet', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'mint', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
] as const

export const MIC_ABI = [
  ...ERC20_ABI,
  { type: 'function', name: 'remainingMiningPool', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'MINING_POOL', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

export const SEED_ABI = [
  { type: 'function', name: 'buyPackage', inputs: [{ name: 'packageIndex', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'active', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'totalRaised', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalAllocated', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'contributions', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'whitelisted', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  // SeedSaleV9 — one call that answers exactly what buyPackage will do, so the page never
  // has to reassemble the rule itself and drift from the contract.
  { type: 'function', name: 'canBuy', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'whitelistRequired', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'setActive', inputs: [{ name: '_active', type: 'bool' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'addToWhitelist', inputs: [{ name: 'users', type: 'address[]' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'HARD_CAP', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'ALLOCATION', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'PRICE_USDT', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'BONUS_BPS', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  {
    type: 'function', name: 'packages', inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: 'usdtCost', type: 'uint256' }, { name: 'nftCount', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

export const PRESALE_ABI = [
  // Updated Apr 30 2026 to match deployed v4 PreSale.sol — function buy(usdtAmount, packageIndex)
  // packageIndex: 0=custom (≥$25), 1=Builder (≥$1K), 2=Maker (≥$2.5K), 3=Luminary (≥$5K)
  { type: 'function', name: 'buy', inputs: [{ name: 'usdtAmount', type: 'uint256' }, { name: 'packageIndex', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'active', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'totalRaised', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalSold', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'HARD_CAP', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'ALLOCATION', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'MIN_USDT', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'MIC_PER_USDT', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

export const LOCK_MANAGER_ABI = [
  { type: 'function', name: 'lockedOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'availableOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'scheduleCount', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  {
    type: 'function', name: 'getSchedules', inputs: [{ name: 'account', type: 'address' }],
    outputs: [{
      type: 'tuple[]', components: [
        { name: 'totalAmount', type: 'uint256' },
        { name: 'startTime', type: 'uint256' },
        { name: 'cliffDuration', type: 'uint256' },
        { name: 'cliffUnlockBps', type: 'uint256' },
        { name: 'monthlyUnlockBps', type: 'uint256' },
      ],
    }],
    stateMutability: 'view',
  },
  {
    type: 'function', name: 'getScheduleAt', inputs: [{ name: 'account', type: 'address' }, { name: 'index', type: 'uint256' }],
    outputs: [{
      type: 'tuple', components: [
        { name: 'totalAmount', type: 'uint256' },
        { name: 'startTime', type: 'uint256' },
        { name: 'cliffDuration', type: 'uint256' },
        { name: 'cliffUnlockBps', type: 'uint256' },
        { name: 'monthlyUnlockBps', type: 'uint256' },
      ],
    }],
    stateMutability: 'view',
  },
] as const

export const MIC_LOCK_ABI = [
  { type: 'function', name: 'lockedBalanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'availableBalanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

export const VESTING_ABI = LOCK_MANAGER_ABI

export const MICE_ABI = [
  // MICELicense exposes getCurrentPrice() and buyLicense(quantity[, referrer]).
  // The old entries here said currentPrice() and buy() — names the contract never had, so
  // every call would have reverted the moment MICE was switched on.
  { type: 'function', name: 'getCurrentPrice', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  // MIC the buyer must hold and burn for a purchase, priced at min(spot, TWAP7d).
  { type: 'function', name: 'quoteMicRequired', inputs: [{ name: 'quantity', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'buyLicense', inputs: [{ name: 'quantity', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getCurrentRound', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'activeLicenses', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalMinted', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'activeCountOf', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getUserLicenses', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256[]' }], stateMutability: 'view' },
  {
    type: 'function', name: 'licenses', inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'purchaseTime', type: 'uint256' }, { name: 'expiryTime', type: 'uint256' }, { name: 'active', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const

export const EMISSION_ABI = [
  { type: 'function', name: 'dailyEmission', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalEmitted', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'eBase', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'demandFactor', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'roiFactor', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'distributeDaily', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'lastDistribution', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

/**
 * MiningPool. Rewards accrue per licence, by the second, from the moment of activation —
 * there are no epochs to claim against and no window to catch. `claim` takes the caller's
 * licence ids; `claimAccrued` takes what was banked when a licence expired or was sold.
 */
export const MINING_ABI = [
  { type: 'function', name: 'pendingOf', inputs: [{ name: 'licenceId', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'claimableOf', inputs: [{ name: 'account', type: 'address' }, { name: 'licenceIds', type: 'uint256[]' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'accrued', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'claim', inputs: [{ name: 'licenceIds', type: 'uint256[]' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'claimAccrued', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'totalActive', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'isActive', inputs: [{ name: '', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
] as const

export const STAKING_ABI = [
  { type: 'function', name: 'totalStakedAmount', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalWeightedStaked', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'stake', inputs: [{ name: 'amount', type: 'uint256' }, { name: 'lockPeriod', type: 'uint8' }, { name: 'useLockedMic', type: 'bool' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'unstake', inputs: [{ name: 'stakeId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'claimRewards', inputs: [{ name: 'stakeId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getUserStakes', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256[]' }], stateMutability: 'view' },
  { type: 'function', name: 'userTier', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  {
    type: 'function', name: 'stakes', inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'amount', type: 'uint256' }, { name: 'weightedAmount', type: 'uint256' },
      { name: 'tier', type: 'uint8' }, { name: 'lockPeriod', type: 'uint8' },
      { name: 'stakeTime', type: 'uint256' }, { name: 'unlockTime', type: 'uint256' },
      { name: 'rewardDebt', type: 'uint256' }, { name: 'active', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  { type: 'function', name: 'pendingReward', inputs: [{ name: 'stakeId', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'accRewardPerShare', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

export const REFERRAL_ABI = [
  { type: 'function', name: 'setReferrer', inputs: [{ name: 'user', type: 'address' }, { name: 'ref', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function', name: 'getReferralInfo', inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: 'ref', type: 'address' }, { name: 'f1Count', type: 'uint256' }, { name: 'f2Count', type: 'uint256' }, { name: 'totalEarnings', type: 'uint256' }],
    stateMutability: 'view',
  },
  { type: 'function', name: 'registered', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'referrer', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

export const MFPNFT_ABI = [
  // Views
  { type: 'function', name: 'totalMinted', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'remainingSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'maxSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'INITIAL_CAP', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'EXPANSION_CAP', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'expansionApproved', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'totalGranted', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'isHolder', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'tokenOfOwnerByIndex', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  // Allowance
  { type: 'function', name: 'mintAllowance', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'mintedCount', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'remainingAllowance', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  // Pair lookup
  {
    type: 'function', name: 'pairOf', inputs: [{ type: 'uint256' }],
    outputs: [{ name: 'imageId', type: 'uint8' }, { name: 'verseId', type: 'uint8' }],
    stateMutability: 'view',
  },
  // Royalty
  { type: 'function', name: 'royaltyReceiver', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'ROYALTY_BPS', inputs: [], outputs: [{ type: 'uint96' }], stateMutability: 'view' },
  // Mutators (require signer)
  { type: 'function', name: 'mint', inputs: [{ name: 'quantity', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'grantMintAllowance', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'revokeMintAllowance', inputs: [{ name: 'from', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'setRoyaltyReceiver', inputs: [{ name: 'newReceiver', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  // Events
  {
    type: 'event', name: 'MFPMinted', anonymous: false,
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'imageId', type: 'uint8', indexed: false },
      { name: 'verseId', type: 'uint8', indexed: false },
    ],
  },
] as const

/**
 * CommunityNFTv2 — an ERC-721, and this ABI now says so.
 *
 * What was here described the ERC-1155 original: `balanceOf(account, id)`,
 * `activeCountOf(user, tier)`, `tierInfo(...)`. CommunityNFT (ERC-1155) was superseded by
 * CommunityNFTv2, which mints a unique serial per token, and none of those functions
 * exists on it. Every call reverted, and both call sites wrapped them in
 * `.catch(() => 0n)`, so a wallet holding three NFTs displayed "-" and nothing was logged.
 *
 * Verified on chain 2026-08-12: supportsInterface(0x80ac58cd) true, (0xd9b67a26) false.
 */
export const COMMUNITY_NFT_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  // Unexpired holdings of one tier. Verified present on chain 2026-08-12 — kept because
  // the dashboard counts with it, and "how many are still valid" is the number that
  // belongs on a dashboard.
  { type: 'function', name: 'activeCountOf', inputs: [{ name: 'user', type: 'address' }, { name: 'tier', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'tokenOfOwnerByIndex', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'ownerOf', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'tierOf', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'expiresAt', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  {
    type: 'function', name: 'meta', inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'tier', type: 'uint8' }, { name: 'mintTime', type: 'uint64' }, { name: 'expiryTime', type: 'uint64' }],
    stateMutability: 'view',
  },
  { type: 'function', name: 'tierMultiplier', inputs: [{ name: 'tier', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalSerials', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

// Helper: format token amounts
export function fmtMIC(value: bigint): string {
  const n = Number(value) / 1e18
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function fmtUSDT(value: bigint): string {
  // BSC-USD is 18 decimals, not 6 — dividing by 1e6 overstated every dollar figure by 10^12.
  const n = Number(value) / 10 ** USDT_DECIMALS
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function fmtPct(value: bigint, total: bigint): number {
  if (total === 0n) return 0
  return Number((value * 10000n) / total) / 100
}
