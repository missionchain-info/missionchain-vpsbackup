/**
 * BlockchainService — Read-only facade for Mission Chain smart contracts.
 *
 * Uses ethers.js v6 to query BSC (testnet or mainnet) and returns typed data.
 * Every public method catches RPC errors and returns sensible defaults so that
 * callers never have to worry about transient network failures.
 */

import { JsonRpcProvider, Contract, formatUnits } from 'ethers'
import {
  ADDRESSES,
  MICTokenABI,
  LockManagerABI,
  NFTStakingABI,
  EmissionControllerABI,
  MiningPoolABI,
  ReferralRegistryABI,
  DAOGovernorABI,
  MFPNFTABI,
  CommunityNFTABI,
  MICELicenseABI,
  PreSaleABI,
  SeedSaleABI,
  RevenueRouterABI,
  MICE_MAX_SUPPLY,
  MICE_ROUND_PRICES_USD,
  MICE_PER_ROUND,
} from '@missionchain/sdk'

// ─── Configuration (mainnet-only as of 2026-05-06) ───────────────────

const BSC_MAINNET_RPC = 'https://bsc-dataseed.binance.org/'

function getRpcUrl(): string {
  return process.env.BSC_RPC_URL || BSC_MAINNET_RPC
}

function getAddresses() {
  return ADDRESSES.bsc
}

// ─── Return Types ────────────────────────────────────────────────────

export interface TokenBalance {
  balance: string
  locked: string
  available: string
}

export interface StakeInfo {
  stakeId: number
  amount: string
  weightedAmount: string
  tier: string
  lockPeriod: number
  startTime: number
  unlockTime: number
  active: boolean
}

export interface MiningInfo {
  pending: string
  hindex: string
  dailyEmission: string
  activeMice: number
}

export interface ReferralData {
  referrer: string | null
  f1Count: number
  f2Count: number
  gvTotal: string
  gvRank: string
}

export interface ProposalInfo {
  proposalId: number
  proposer: string
  title: string
  description: string
  category: string
  status: number
  forVotes: string
  againstVotes: string
  createdAt: number
  expiresAt: number
  executedAt: number
}

export interface NFTHoldings {
  mfp: number
  community: {
    builder: number
    maker: number
    luminary: number
  }
}

export interface MICEData {
  totalSold: number
  currentRound: number
  currentPrice: number
}

export interface SaleData {
  seed: { raised: string; remaining: string }
  preSale: { raised: string; remaining: string }
}

export interface EmissionData {
  currentRate: string
  totalEmitted: string
  daysSinceStart: number
  poolRemaining: string
}

// ─── GV Rank Thresholds ──────────────────────────────────────────────

const GV_RANKS: Array<{ name: string; threshold: number }> = [
  { name: 'Legend', threshold: 500_000 },
  { name: 'Ambassador', threshold: 150_000 },
  { name: 'Champion', threshold: 50_000 },
  { name: 'Connector', threshold: 20_000 },
  { name: 'Builder', threshold: 5_000 },
  { name: 'Believer', threshold: 0 },
]

function gvRankFromTotal(totalUsd: number): string {
  for (const r of GV_RANKS) {
    if (totalUsd >= r.threshold) return r.name
  }
  return 'Believer'
}

// ─── Service Class ───────────────────────────────────────────────────

export class BlockchainService {
  public readonly provider: JsonRpcProvider
  public readonly addr = getAddresses()

  // Contract instances (lazy-initialized)
  public readonly micToken: Contract
  public readonly lockManager: Contract
  public readonly nftStaking: Contract
  public readonly emissionController: Contract
  public readonly miningPool: Contract
  public readonly referralRegistry: Contract
  public readonly daoGovernor: Contract
  public readonly mfpNFT: Contract
  public readonly communityNFT: Contract
  public readonly miceLicense: Contract
  public readonly preSale: Contract
  public readonly seedSale: Contract
  public readonly revenueRouter: Contract

  constructor() {
    this.provider = new JsonRpcProvider(getRpcUrl())

    this.micToken = new Contract(this.addr.MICToken, MICTokenABI, this.provider)
    this.lockManager = new Contract(this.addr.LockManager, LockManagerABI, this.provider)
    this.nftStaking = new Contract(this.addr.NFTStaking, NFTStakingABI, this.provider)
    this.emissionController = new Contract(this.addr.EmissionController, EmissionControllerABI, this.provider)
    this.miningPool = new Contract(this.addr.MiningPool, MiningPoolABI, this.provider)
    this.referralRegistry = new Contract(this.addr.ReferralRegistry, ReferralRegistryABI, this.provider)
    this.daoGovernor = new Contract(this.addr.DAOGovernor, DAOGovernorABI, this.provider)
    this.mfpNFT = new Contract(this.addr.MFPNFT, MFPNFTABI, this.provider)
    this.communityNFT = new Contract(this.addr.CommunityNFT, CommunityNFTABI, this.provider)
    this.miceLicense = new Contract(this.addr.MICELicense, MICELicenseABI, this.provider)
    this.preSale = new Contract(this.addr.PreSale, PreSaleABI, this.provider)
    this.seedSale = new Contract(this.addr.SeedSale, SeedSaleABI, this.provider)
    this.revenueRouter = new Contract(this.addr.RevenueRouter, RevenueRouterABI, this.provider)
  }

  // ── Token Balance ────────────────────────────────────────────────

  async getTokenBalance(wallet: string): Promise<TokenBalance> {
    try {
      const [balance, locked] = await Promise.all([
        this.micToken.balanceOf(wallet) as Promise<bigint>,
        this.lockManager.lockedOf(wallet) as Promise<bigint>,
      ])
      const available = balance - locked
      return {
        balance: formatUnits(balance, 18),
        locked: formatUnits(locked, 18),
        available: formatUnits(available > 0n ? available : 0n, 18),
      }
    } catch (err) {
      console.error('[BlockchainService] getTokenBalance error:', err)
      return { balance: '0', locked: '0', available: '0' }
    }
  }

  // ── Staking Positions ────────────────────────────────────────────

  async getStakingPositions(wallet: string): Promise<StakeInfo[]> {
    try {
      const stakeIds = await this.nftStaking.getUserStakes(wallet) as bigint[]
      const stakeRows = await Promise.all(
        stakeIds.map((stakeId) => this.nftStaking.stakes(stakeId))
      )

      return stakeRows.map((s: any, index: number) => ({
        stakeId: Number(stakeIds[index]),
        amount: formatUnits(s.amount ?? s[0], 18),
        weightedAmount: formatUnits(s.weightedAmount ?? s[1], 18),
        tier: tierToString(Number(s.tier ?? s[2])),
        lockPeriod: Number(s.lockPeriod ?? s[3]),
        startTime: Number(s.stakeTime ?? s[4]),
        unlockTime: Number(s.unlockTime ?? s[5]),
        active: Boolean(s.active ?? s[7]),
      }))
    } catch (err) {
      console.error('[BlockchainService] getStakingPositions error:', err)
      return []
    }
  }

  // ── Mining Info ──────────────────────────────────────────────────

  async getMiningInfo(wallet: string): Promise<MiningInfo> {
    try {
      const [dailyEmission, totalMinted, currentEpochRaw] = await Promise.all([
        this.emissionController.dailyEmission() as Promise<bigint>,
        this.miceLicense.totalMinted() as Promise<bigint>,
        this.miningPool.currentEpoch().catch(() => 0n) as Promise<bigint>,
      ])

      const currentEpoch = Number(currentEpochRaw)
      let pendingTotal = 0n
      let hindex = 0n
      for (let epoch = Math.max(1, currentEpoch - 6); epoch <= currentEpoch; epoch++) {
        try {
          const [pending, alreadyClaimed] = await Promise.all([
            this.miningPool.pendingReward(epoch, wallet) as Promise<bigint>,
            this.miningPool.claimed(epoch, wallet) as Promise<boolean>,
          ])
          if (!alreadyClaimed) pendingTotal += pending
          if (epoch === currentEpoch) {
            hindex = await this.miningPool.getScore(epoch, wallet) as bigint
          }
        } catch {
          // Ignore epochs that are not ready or absent.
        }
      }

      return {
        pending: formatUnits(pendingTotal, 18),
        hindex: hindex.toString(),
        dailyEmission: formatUnits(dailyEmission, 18),
        activeMice: Number(totalMinted),
      }
    } catch (err) {
      console.error('[BlockchainService] getMiningInfo error:', err)
      return { pending: '0', hindex: '0', dailyEmission: '0', activeMice: 0 }
    }
  }

  // ── Referral Info ────────────────────────────────────────────────

  async getReferralInfo(wallet: string): Promise<ReferralData> {
    try {
      const referrer = await this.referralRegistry.referrerOf(wallet) as string
      const gvRaw = await this.referralRegistry.groupVolume(wallet) as bigint

      // Group volume is in USDT (6 decimals)
      const gvFloat = parseFloat(formatUnits(gvRaw, 6))
      const rank = gvRankFromTotal(gvFloat)

      // F1/F2 counts are not directly stored on ReferralRegistry in this design;
      // they come from off-chain indexing. Return 0 as defaults.
      return {
        referrer: referrer === '0x0000000000000000000000000000000000000000' ? null : referrer,
        f1Count: 0,
        f2Count: 0,
        gvTotal: formatUnits(gvRaw, 6),
        gvRank: rank,
      }
    } catch (err) {
      console.error('[BlockchainService] getReferralInfo error:', err)
      return { referrer: null, f1Count: 0, f2Count: 0, gvTotal: '0', gvRank: 'Believer' }
    }
  }

  // ── DAO Proposals ────────────────────────────────────────────────

  async getDAOProposals(): Promise<ProposalInfo[]> {
    try {
      const countBN = await this.daoGovernor.proposalCount() as bigint
      const count = Number(countBN)
      if (count === 0) return []

      // Fetch last 50 proposals maximum
      const start = Math.max(1, count - 49)
      const proposals: ProposalInfo[] = []

      for (let i = start; i <= count; i++) {
        try {
          const p = await this.daoGovernor.getProposal(i)
          proposals.push({
            proposalId: i,
            proposer: p.proposer ?? p[0],
            title: p.title ?? p[1] ?? '',
            description: p.description ?? p[2] ?? '',
            category: p.category != null ? String(p.category) : String(p[3] ?? ''),
            status: Number(p.status ?? p[4]),
            forVotes: (p.forVotes ?? p[5] ?? 0n).toString(),
            againstVotes: (p.againstVotes ?? p[6] ?? 0n).toString(),
            createdAt: Number(p.createdAt ?? p[7] ?? 0),
            expiresAt: Number(p.expiresAt ?? p[8] ?? 0),
            executedAt: Number(p.executedAt ?? p[9] ?? 0),
          })
        } catch {
          // Individual proposal fetch failure — skip
        }
      }

      return proposals
    } catch (err) {
      console.error('[BlockchainService] getDAOProposals error:', err)
      return []
    }
  }

  // ── NFT Holdings ─────────────────────────────────────────────────

  async getNFTHoldings(wallet: string): Promise<NFTHoldings> {
    try {
      const [mfpBalance, builderBal, makerBal, luminaryBal] = await Promise.all([
        this.mfpNFT.balanceOf(wallet) as Promise<bigint>,
        // CommunityNFT is ERC-1155 — tier IDs: BUILDER=1, MAKER=2, LUMINARY=3
        this.communityNFT.balanceOf(wallet, 1) as Promise<bigint>,
        this.communityNFT.balanceOf(wallet, 2) as Promise<bigint>,
        this.communityNFT.balanceOf(wallet, 3) as Promise<bigint>,
      ])

      return {
        mfp: Number(mfpBalance),
        community: {
          builder: Number(builderBal),
          maker: Number(makerBal),
          luminary: Number(luminaryBal),
        },
      }
    } catch (err) {
      console.error('[BlockchainService] getNFTHoldings error:', err)
      return { mfp: 0, community: { builder: 0, maker: 0, luminary: 0 } }
    }
  }

  // ── MICE Info ────────────────────────────────────────────────────

  async getMICEInfo(): Promise<MICEData> {
    try {
      const [totalMinted, currentRound] = await Promise.all([
        this.miceLicense.totalMinted() as Promise<bigint>,
        this.miceLicense.getCurrentRound() as Promise<bigint>,
      ])
      const round = Math.max(1, Number(currentRound))
      const priceIndex = Math.min(round - 1, MICE_ROUND_PRICES_USD.length - 1)

      return {
        totalSold: Number(totalMinted),
        currentRound: round,
        currentPrice: MICE_ROUND_PRICES_USD[priceIndex],
      }
    } catch (err) {
      console.error('[BlockchainService] getMICEInfo error:', err)
      return { totalSold: 0, currentRound: 1, currentPrice: MICE_ROUND_PRICES_USD[0] }
    }
  }

  // ── Sale Info ────────────────────────────────────────────────────

  async getSaleInfo(): Promise<SaleData> {
    try {
      const [seedSold, preSaleRaised, preSaleSold] = await Promise.all([
        this.seedSale.totalSold() as Promise<bigint>,
        this.preSale.totalRaised() as Promise<bigint>,
        this.preSale.totalSold() as Promise<bigint>,
      ])

      // SeedSale public-sale allocation: 152,500,000 MIC (75M Strategic Partner Grant
      // is admin-issued separately and not tracked by this contract).
      const seedAllocation = 152_500_000n * 10n ** 18n
      const seedRemaining = seedAllocation - seedSold

      // PreSale allocation: 315,000,000 MIC
      const preSaleAllocation = 315_000_000n * 10n ** 18n
      const preSaleRemaining = preSaleAllocation - preSaleSold

      return {
        seed: {
          raised: formatUnits(seedSold, 18),
          remaining: formatUnits(seedRemaining > 0n ? seedRemaining : 0n, 18),
        },
        preSale: {
          raised: formatUnits(preSaleRaised, 6), // USDT 6 decimals
          remaining: formatUnits(preSaleRemaining > 0n ? preSaleRemaining : 0n, 18),
        },
      }
    } catch (err) {
      console.error('[BlockchainService] getSaleInfo error:', err)
      return {
        seed: { raised: '0', remaining: '227500000' },
        preSale: { raised: '0', remaining: '315000000' },
      }
    }
  }

  // ── Emission Data ────────────────────────────────────────────────

  async getEmissionData(): Promise<EmissionData> {
    // dailyEmission() reverts when activeMICE == 0 (expected — per emission contract guard).
    // Use allSettled so one expected revert doesn't poison the whole batch.
    const [dailyRes, totalRes, deployRes, poolRes] = await Promise.allSettled([
      this.emissionController.dailyEmission() as Promise<bigint>,
      this.emissionController.totalEmitted() as Promise<bigint>,
      this.emissionController.deployTime() as Promise<bigint>,
      this.micToken.remainingMiningPool() as Promise<bigint>,
    ])

    const dailyEmission = dailyRes.status === 'fulfilled' ? dailyRes.value : 0n
    const totalEmitted = totalRes.status === 'fulfilled' ? totalRes.value : 0n
    const deployTime = deployRes.status === 'fulfilled' ? deployRes.value : 0n
    const remainingPool = poolRes.status === 'fulfilled' ? poolRes.value : 5_950_000_000n * 10n ** 18n

    const now = Math.floor(Date.now() / 1000)
    const daysSinceStart = deployTime > 0n ? Math.floor((now - Number(deployTime)) / 86400) : 0

    return {
      currentRate: formatUnits(dailyEmission, 18),
      totalEmitted: formatUnits(totalEmitted, 18),
      daysSinceStart: Math.max(0, daysSinceStart),
      poolRemaining: formatUnits(remainingPool, 18),
    }
  }

  // ── Current Block ────────────────────────────────────────────────

  async getCurrentBlock(): Promise<number> {
    try {
      return await this.provider.getBlockNumber()
    } catch {
      return 0
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

const TIER_MAP: Record<number, string> = {
  0: 'NoNFT',
  1: 'Builder',
  2: 'Maker',
  3: 'Luminary',
  4: 'MFP',
}

function tierToString(tier: number): string {
  return TIER_MAP[tier] ?? `Unknown(${tier})`
}
