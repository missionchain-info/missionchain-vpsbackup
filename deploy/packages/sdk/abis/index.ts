// Auto-generated ABI re-exports — run `node scripts/extract-abis.js` to refresh
// Note: JSON files are Hardhat artifacts; we extract the `.abi` array for ethers.js

// Token
import _MICTokenABI from './MICToken.json'
import _LockManagerABI from './LockManager.json'

// Sales
import _SeedSaleABI from './SeedSale.json'
import _PreSaleABI from './PreSale.json'
import _MICELicenseABI from './MICELicense.json'
import _AirdropDistributorABI from './AirdropDistributor.json'

// Referral
import _ReferralRegistryABI from './ReferralRegistry.json'

// Mining & Staking
import _EmissionControllerABI from './EmissionController.json'
import _MiningPoolABI from './MiningPool.json'
import _NFTStakingABI from './NFTStaking.json'

// NFTs
import _MFPNFTABI from './MFPNFT.json'
import _CommunityNFTABI from './CommunityNFT.json'

// Revenue
import _RevenueRouterABI from './RevenueRouter.json'
import _SeedBudgetABI from './SeedBudget.json'

// Rewards
import _RewardDistributorABI from './RewardDistributor.json'
import _ClaimRewardsABI from './ClaimRewards.json'
import _PeriodicRewardsABI from './PeriodicRewards.json'
import _LuckyDrawABI from './LuckyDraw.json'
import _IncentivePoolABI from './IncentivePool.json'

// Infrastructure
import _ManagementPoolABI from './ManagementPool.json'
import _LiquidityPoolABI from './LiquidityPool.json'
import _TreasuryManagerABI from './TreasuryManager.json'

// Governance
import _DAOGovernorABI from './DAOGovernor.json'

// Mock (testnet only)
import _MockUSDTABI from './MockUSDT.json'

function abiOf<T>(artifact: T): T extends { abi: infer U } ? U : T {
  return ((artifact as any)?.abi ?? artifact) as any
}

export const MICTokenABI = abiOf(_MICTokenABI)
export const LockManagerABI = abiOf(_LockManagerABI)
export const SeedSaleABI = abiOf(_SeedSaleABI)
export const PreSaleABI = abiOf(_PreSaleABI)
export const MICELicenseABI = abiOf(_MICELicenseABI)
export const AirdropDistributorABI = abiOf(_AirdropDistributorABI)
export const ReferralRegistryABI = abiOf(_ReferralRegistryABI)
export const EmissionControllerABI = abiOf(_EmissionControllerABI)
export const MiningPoolABI = abiOf(_MiningPoolABI)
export const NFTStakingABI = abiOf(_NFTStakingABI)
export const MFPNFTABI = abiOf(_MFPNFTABI)
export const CommunityNFTABI = abiOf(_CommunityNFTABI)
export const RevenueRouterABI = abiOf(_RevenueRouterABI)
export const SeedBudgetABI = abiOf(_SeedBudgetABI)
export const RewardDistributorABI = abiOf(_RewardDistributorABI)
export const ClaimRewardsABI = abiOf(_ClaimRewardsABI)
export const PeriodicRewardsABI = abiOf(_PeriodicRewardsABI)
export const LuckyDrawABI = abiOf(_LuckyDrawABI)
export const IncentivePoolABI = abiOf(_IncentivePoolABI)
export const ManagementPoolABI = abiOf(_ManagementPoolABI)
export const LiquidityPoolABI = abiOf(_LiquidityPoolABI)
export const TreasuryManagerABI = abiOf(_TreasuryManagerABI)
export const DAOGovernorABI = abiOf(_DAOGovernorABI)
export const MockUSDTABI = abiOf(_MockUSDTABI)
