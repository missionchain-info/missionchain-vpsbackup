// Mission Chain Smart Contract Addresses & ABIs — BSC Mainnet (Phase 0 Genesis)
// Phase 0 Genesis deployed 2026-05-06 (16 contracts). Phase 1 expansion + Phase 2/3 = zero address until deployed.
// Source: SDK @missionchain/sdk addresses.bsc namespace

export const CONTRACTS = {
  // Tokens & Vesting
  usdt: '0x55d398326f99059fF775485246999027B3197955' as const,
  mic: '0xf27ec0c311728b923b22828002c992c799326182' as const,
  micToken: '0xf27ec0c311728b923b22828002c992c799326182' as const, // alias for Header.tsx
  lockManager: '0x6bE58BCe62f526E7751e121CDBa1eb22873471A0' as const,
  vesting: '0x6bE58BCe62f526E7751e121CDBa1eb22873471A0' as const, // @deprecated alias → lockManager
  referral: '0x0000000000000000000000000000000000000000' as const,

  // NFTs
  mfpNft: '0xAE6F32A6fdf80F5e54ba85441386dBA6a381f565' as const,    // SEED_CAP=1250, ROYALTY 5%, STAKING_MULTIPLIER ×25
  communityNft: '0x2828C97397be51FCCa5D8D99a0c5126F11A15149' as const,

  // Sales (SEED + 75M Old Investors holding, PreSale, MICE 100% USDT flow)
  seed: '0xe4C1B4fBE009245eBB6B3a4F76DcAAE445F60905' as const, // V7 (2026-06-23) — replaces V6 0x7ce5AcDC5DACf59aaB130C963ac461f902A5e5A0
  presale: '0x0000000000000000000000000000000000000000' as const,
  airdrop: '0x9Bdd75b6aDf5BA674F74C49601AF7D82d3672EF9' as const,
  mice: '0x0000000000000000000000000000000000000000' as const,       // 100% USDT, 50% → LP burn

  // Mining & Staking
  mining: '0x0000000000000000000000000000000000000000' as const,     // reservedForPriorEpochs fix
  staking: '0x0000000000000000000000000000000000000000' as const,    // MIC time-lock staking (NFTStaking contract, tier deprecated)
  emission: '0x0000000000000000000000000000000000000000' as const,

  // Revenue routing
  revenueRouter: '0x0000000000000000000000000000000000000000' as const,
  seedBudget: '0x33ec0A97029adde1A7e0f78E3B8f414Ec56527ef' as const, // V5c (2026-06-23) — replaces V5b 0xf7a839A271d8F5A7b19a42eCD7f7E604A3dcEC1a
  operationalSalaryPool: '0xB2f318b07B7501f6A03b53066610032418F66b85' as const, // V3 (2026-06-23) — replaces V2 0xf3fDaD73CCf9Ccf1D42fc4d772efad9BB7E17576
  managementBonusPool: '0x2bfA50146C01d6c4BFA4A2550385988C2619f033' as const, // V3 (2026-06-23) — replaces V2 0x71E3D41F2d5464576fA7aCfd42bcEAA2c1E0578B
  reservedExpensesPool: '0xe04519547F051AE4388FcdE571EA2301dD9e3495' as const, // V3 (2026-06-23) — replaces V2 0xC92963834a5F992b6599aD19eF18061594C23154
  rewardDistributor: '0x0000000000000000000000000000000000000000' as const,

  // Reward sub-pools
  claimRewards: '0x0000000000000000000000000000000000000000' as const,    // BPS 4167/2083/3750
  periodicRewards: '0x0000000000000000000000000000000000000000' as const,
  luckyDraw: '0x0000000000000000000000000000000000000000' as const,
  incentivePool: '0x0000000000000000000000000000000000000000' as const,

  // Infrastructure
  daoGovernor: '0xDCD65DC97b0A147BeCf542E22a5C218C006231cC' as const,
  managementPool: '0x0000000000000000000000000000000000000000' as const,
  treasuryManager: '0x1ed5C848D1244a618Bd95Ff92d4f8C2356d3a42F' as const,
  liquidityPool: '0x37091454eB49179D3aFF12402980F63cFC3e050a' as const,    // + USDT→MIC swap+burn for MICE
  foundersVault: '0x142167334Ad8da6790353dC54c42651F9F416b67' as const,    // NEW Apr 28: 280M MIC + 1,250 MFP cap
} as const
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
  { type: 'function', name: 'currentPrice', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'activeLicenses', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalMinted', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'purchase', inputs: [], outputs: [], stateMutability: 'nonpayable' },
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

export const MINING_ABI = [
  { type: 'function', name: 'currentEpoch', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'pendingReward', inputs: [{ name: 'epoch', type: 'uint256' }, { name: 'miner', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'claimReward', inputs: [{ name: 'epoch', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getScore', inputs: [{ name: 'epoch', type: 'uint256' }, { name: 'miner', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
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

export const COMMUNITY_NFT_ABI = [
  { type: 'function', name: 'highestActiveTier', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'activeCountOf', inputs: [{ name: 'user', type: 'address' }, { name: 'tierId', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'remainingDays', inputs: [{ name: 'user', type: 'address' }, { name: 'instanceIndex', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }, { name: 'id', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  {
    type: 'function', name: 'tierInfo', inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: 'name', type: 'string' }, { name: 'multiplierX10', type: 'uint256' }, { name: 'durationDays', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

// Helper: format token amounts
export function fmtMIC(value: bigint): string {
  const n = Number(value) / 1e18
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function fmtUSDT(value: bigint): string {
  const n = Number(value) / 1e6
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function fmtPct(value: bigint, total: bigint): number {
  if (total === 0n) return 0
  return Number((value * 10000n) / total) / 100
}
