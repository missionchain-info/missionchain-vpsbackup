/**
 * EventIndexer — Background worker that polls blockchain events and persists
 * them to the database via Prisma.
 *
 * Uses the SyncCursor model to track the last indexed block per contract,
 * and writes raw events to BlockchainEvent. It also updates denormalized
 * tables (Purchase, StakingPosition, NFTItem, etc.) for faster queries.
 *
 * Polls every 15 seconds. Gracefully handles RPC errors and DB outages.
 */

import { Contract, Log, EventLog, Interface, formatUnits, JsonRpcProvider } from 'ethers'
import type { PrismaClient } from '@missionchain/db'
import { BlockchainService } from './blockchain'

// ─── Types ───────────────────────────────────────────────────────────

interface EventMapping {
  contractName: string
  contract: Contract
  events: string[]
}

interface IndexerOptions {
  prisma: PrismaClient
  blockchain: BlockchainService
  pollIntervalMs?: number
  batchSize?: number
}

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL = 45_000 // 45s (ease free-RPC rate limit)
const DEFAULT_BATCH_SIZE = 10 // Alchemy free tier: getLogs max 10-block-inclusive range
const LOOKBACK_BLOCKS = 100 // how far back to scan on first start

// ─── Indexer Class ───────────────────────────────────────────────────

export class EventIndexer {
  private readonly prisma: PrismaClient
  private readonly blockchain: BlockchainService
  private readonly pollIntervalMs: number
  private readonly batchSize: number
  private readonly logsProvider: JsonRpcProvider | null
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private processing = false

  constructor(options: IndexerOptions) {
    this.prisma = options.prisma
    this.blockchain = options.blockchain
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
    // Dedicated getLogs provider: free BSC public RPCs (publicnode/dataseed) reject
    // eth_getLogs ("archive required"). INDEXER_RPC_URL points to a getLogs-capable
    // endpoint (e.g. 1rpc.io/bnb). Falls back to the shared provider when unset.
    const indexerRpc = process.env.INDEXER_RPC_URL
    this.logsProvider = indexerRpc ? new JsonRpcProvider(indexerRpc) : null
    if (indexerRpc) console.log(`[Indexer] getLogs via dedicated RPC: ${indexerRpc}`)
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  start(): void {
    if (this.running) return
    this.running = true
    console.log('[Indexer] Starting event indexer...')

    // Run immediately, then schedule recurring polls
    this.poll().catch((err) => console.error('[Indexer] Initial poll error:', err))
    this.timer = setInterval(() => {
      this.poll().catch((err) => console.error('[Indexer] Poll error:', err))
    }, this.pollIntervalMs)
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    console.log('[Indexer] Stopped.')
  }

  // ── Core Poll Loop ─────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.processing) return // skip if previous poll still running
    this.processing = true

    try {
      const currentBlock = await this.blockchain.getCurrentBlock()
      if (currentBlock === 0) {
        console.warn('[Indexer] Could not fetch current block — skipping cycle.')
        return
      }

      const mappings = this.getEventMappings()

      for (const mapping of mappings) {
        try {
          await this.indexContract(mapping, currentBlock)
        } catch (err) {
          console.error(`[Indexer] Error indexing ${mapping.contractName}:`, err)
        }
      }
    } finally {
      this.processing = false
    }
  }

  // ── Per-Contract Indexing ──────────────────────────────────────

  private async indexContract(mapping: EventMapping, currentBlock: number): Promise<void> {
    const { contractName, contract, events } = mapping

    // Skip contracts that are not deployed on the active network (zero address).
    // Phase 1 Minimal mainnet only has 16 contracts — Phase 2 contracts (NFTStaking,
    // EmissionController, RevenueRouter, ReferralRegistry, etc) point at 0x0 until deploy.
    const targetAddr = (contract.target as string | undefined)?.toLowerCase?.() ?? ''
    if (!targetAddr || targetAddr === '0x0000000000000000000000000000000000000000') {
      return
    }

    // Get or create sync cursor
    let cursor = await this.prisma.syncCursor.findUnique({
      where: { contractName },
    })

    let fromBlock = cursor
      ? cursor.lastBlock + 1
      : Math.max(0, currentBlock - LOOKBACK_BLOCKS)

    // Public BSC RPCs (e.g. bsc-dataseed) prune historical state ~10K blocks back.
    // If our cursor is older than the prune window, skip ahead to a safe recent block.
    // This stops the indexer from getting permanently stuck after extended downtime.
    const MAX_RPC_HISTORY = 9000
    if (currentBlock - fromBlock > MAX_RPC_HISTORY) {
      const skipTo = currentBlock - LOOKBACK_BLOCKS
      console.warn(
        `[Indexer] ${contractName} cursor too old (${fromBlock} vs current ${currentBlock}). ` +
        `Public RPC likely pruned data — skipping to ${skipTo}.`,
      )
      fromBlock = skipTo
    }

    if (fromBlock > currentBlock) return // already up to date

    // Process in batches to avoid RPC limits
    let batchStart = fromBlock
    while (batchStart <= currentBlock) {
      const batchEnd = Math.min(batchStart + this.batchSize - 1, currentBlock)
      let batchHadError = false

      for (const eventName of events) {
        try {
          const filter = contract.filters[eventName]?.()
          if (!filter) continue

          const queryContract = this.logsProvider
            ? (contract.connect(this.logsProvider) as Contract)
            : contract
          const logs = await queryContract.queryFilter(filter, batchStart, batchEnd)

          for (const log of logs) {
            await this.processLog(contractName, eventName, log, contract)
          }

          // Throttle between event queries to avoid public-RPC rate limit
          // (BSC public nodes throttle aggressively when queried in tight loop).
          await new Promise((r) => setTimeout(r, 600))
        } catch (err: any) {
          const msg = err?.message || ''
          const code = err?.error?.code ?? err?.info?.error?.code

          // Detect "history pruned" errors from public RPCs (-32701).
          const isPruned =
            code === -32701 ||
            code === -32602 ||
            /history has been pruned|pruned for this block|archive requests? require/i.test(msg)
          if (isPruned) {
            const skipTo = currentBlock - LOOKBACK_BLOCKS
            console.warn(
              `[Indexer] ${contractName}.${eventName}: RPC pruned blocks [${batchStart}-${batchEnd}]. ` +
              `Advancing cursor to ${skipTo} to recover.`,
            )
            await this.prisma.syncCursor.upsert({
              where: { contractName },
              create: { contractName, lastBlock: skipTo },
              update: { lastBlock: skipTo },
            })
            return // exit indexContract for this cycle
          }

          // Detect rate-limit errors (-32005). Don't advance cursor — retry on next poll.
          const isRateLimit =
            code === -32005 ||
            /rate limit|too many requests|429/i.test(msg)
          if (isRateLimit) {
            // Free RPC throttling — expected, silent retry next poll
            batchHadError = true
            // Back off harder before next event to give RPC headroom
            await new Promise((r) => setTimeout(r, 1500))
            continue
          }

          // Transient getLogs failure (free RPC limit/forbidden) — retry next poll, don't spam
          if (/forbidden|limited to|exceeded|too many|cu limit/i.test(msg)) {
            batchHadError = true
          } else {
            console.error(`[Indexer] Error querying ${contractName}.${eventName} [${batchStart}-${batchEnd}]:`, msg.slice(0, 120))
            batchHadError = true
          }
        }
      }

      // Only advance cursor if entire batch succeeded — otherwise retry on next poll.
      if (!batchHadError) {
        await this.prisma.syncCursor.upsert({
          where: { contractName },
          create: { contractName, lastBlock: batchEnd },
          update: { lastBlock: batchEnd },
        })
      } else {
        // Stop this contract's processing for this cycle; pick up from same fromBlock next poll.
        return
      }

      batchStart = batchEnd + 1
    }
  }

  // ── Log Processing ─────────────────────────────────────────────

  private async processLog(
    contractName: string,
    eventName: string,
    log: Log | EventLog,
    contract: Contract
  ): Promise<void> {
    // Parse event arguments
    let args: Record<string, any> = {}
    try {
      if ('args' in log && log.args) {
        // EventLog already has parsed args
        args = logArgsToObject(log.args, contract.interface, eventName)
      } else {
        // Raw Log — need to parse manually
        const parsed = contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        })
        if (parsed) {
          args = logArgsToObject(parsed.args, contract.interface, eventName)
        }
      }
    } catch {
      // If we can't parse, store raw topics/data
      args = { topics: log.topics, data: log.data }
    }

    // Store raw event (idempotent via unique txHash+logIndex)
    try {
      await this.prisma.blockchainEvent.upsert({
        where: {
          txHash_logIndex: {
            txHash: log.transactionHash,
            logIndex: log.index,
          },
        },
        create: {
          contractName,
          eventName,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          args: args as any,
        },
        update: {}, // no-op if already exists
      })
    } catch (err) {
      // Duplicate key race — safe to ignore
      if (!isDuplicateError(err)) {
        console.error(`[Indexer] DB error storing ${contractName}.${eventName}:`, err)
      }
      return
    }

    // Update denormalized tables
    await this.handleDenormalized(contractName, eventName, args, log)
  }

  // ── Denormalized Table Updates ─────────────────────────────────

  private async handleDenormalized(
    contractName: string,
    eventName: string,
    args: Record<string, any>,
    log: Log | EventLog
  ): Promise<void> {
    try {
      switch (`${contractName}:${eventName}`) {
        // ─ Purchases ────────────────────────────────────────────
        case 'SeedSale:SeedPurchase':
          await this.handleSeedPurchase(args, log)
          break

        case 'PreSale:PreSalePurchase':
          await this.handlePreSalePurchase(args, log)
          break

        case 'MICELicense:LicensePurchased':
          await this.handleMICEPurchase(args, log)
          break

        // ─ Staking ──────────────────────────────────────────────
        case 'NFTStaking:Staked':
          await this.handleStaked(args, log)
          break

        case 'NFTStaking:Unstaked':
          await this.handleUnstaked(args, log)
          break

        case 'NFTStaking:RewardClaimed':
          await this.handleStakingRewardClaimed(args, log)
          break

        // ─ NFTs ─────────────────────────────────────────────────
        case 'MFPNFT:MFPGranted':
          await this.handleMFPGranted(args, log)
          break

        case 'MFPNFT:MFPRevoked':
          await this.handleMFPRevoked(args, log)
          break

        case 'MFPNFT:MFPMinted':
          await this.handleMFPMinted(args, log)
          break

        case 'MFPNFT:MFPBatchMinted':
          // Legacy event from old contract — kept for backward compat
          await this.handleMFPBatchMinted(args, log)
          break

        case 'MFPNFT:RoyaltyReceiverUpdated':
          await this.handleRoyaltyReceiverUpdated(args)
          break

        case 'CommunityNFT:CommunityNFTMinted':
          await this.handleCommunityNFTMinted(args, log)
          break

        // ─ Referrals ────────────────────────────────────────────
        case 'ReferralRegistry:ReferrerSet':
          await this.handleReferrerSet(args)
          break

        case 'ReferralRegistry:RewardDistributed':
          await this.handleReferralReward(args, log)
          break

        // ─ DAO ──────────────────────────────────────────────────
        case 'DAOGovernor:ProposalCreated':
          await this.handleProposalCreated(args, log)
          break

        case 'DAOGovernor:ProposalApproved':
          await this.handleProposalApproved(args)
          break

        case 'DAOGovernor:ProposalExecuted':
          await this.handleProposalExecuted(args)
          break

        // ─ Emission ─────────────────────────────────────────────
        case 'EmissionController:DailyDistributed':
          // Logged for analytics — no denormalized table update needed
          break

        // ─ Revenue ──────────────────────────────────────────────
        case 'RevenueRouter:RevenueDistributed':
          // Logged for analytics — no denormalized table update needed
          break
      }
    } catch (err) {
      console.error(`[Indexer] Denorm update failed for ${contractName}:${eventName}:`, err)
    }
  }

  // ── Individual Handlers ────────────────────────────────────────

  private async handleSeedPurchase(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    const wallet = (args.buyer as string).toLowerCase()
    await this.ensureUser(wallet)

    await this.prisma.purchase.upsert({
      where: { txHash: log.transactionHash },
      create: {
        wallet,
        type: 'SEED',
        packageName: args.packageName ?? null,
        usdtAmount: formatUnits(args.usdtAmount ?? 0n, 6),
        micAmount: formatUnits(args.micAmount ?? 0n, 18),
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      },
      update: {},
    })

    await this.prisma.user.update({
      where: { wallet },
      data: { seedPurchased: true },
    })
  }

  private async handlePreSalePurchase(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    const wallet = (args.buyer as string).toLowerCase()
    await this.ensureUser(wallet)

    await this.prisma.purchase.upsert({
      where: { txHash: log.transactionHash },
      create: {
        wallet,
        type: 'PRESALE',
        packageName: args.packageName ?? null,
        usdtAmount: formatUnits(args.usdtAmount ?? 0n, 6),
        micAmount: formatUnits(args.micAmount ?? 0n, 18),
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        referrerWallet: args.referrer ? (args.referrer as string).toLowerCase() : null,
      },
      update: {},
    })

    await this.prisma.user.update({
      where: { wallet },
      data: { preSalePurchased: true },
    })
  }

  private async handleMICEPurchase(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    const wallet = (args.buyer as string).toLowerCase()
    await this.ensureUser(wallet)

    await this.prisma.purchase.upsert({
      where: { txHash: log.transactionHash },
      create: {
        wallet,
        type: 'MICE',
        usdtAmount: formatUnits(args.usdtPaid ?? 0n, 6),
        micAmount: formatUnits(args.micBurned ?? 0n, 18),
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      },
      update: {},
    })
  }

  private async handleStaked(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    const wallet = (args.user as string).toLowerCase()
    await this.ensureUser(wallet)

    const TIER_NAMES: Record<number, string> = { 0: 'NoNFT', 1: 'Builder', 2: 'Maker', 3: 'Luminary', 4: 'MFP' }
    const LOCK_NAMES: Record<number, string> = { 30: 'Days30', 90: 'Days90', 180: 'Days180', 360: 'Days360' }

    const tier = Number(args.tier ?? 0)
    const lockDays = Number(args.lockPeriod ?? 30)
    const startTime = Number(args.startTime ?? 0)
    const amount = args.amount ?? 0n

    await this.prisma.stakingPosition.upsert({
      where: { txHash: log.transactionHash },
      create: {
        wallet,
        stakeId: Number(args.stakeId ?? 0),
        amount: formatUnits(amount, 18),
        weightedAmount: formatUnits(args.weightedAmount ?? amount, 18),
        tier: TIER_NAMES[tier] ?? 'NoNFT',
        lockPeriod: LOCK_NAMES[lockDays] ?? `Days${lockDays}`,
        stakeTime: new Date(startTime * 1000),
        unlockTime: new Date((startTime + lockDays * 86400) * 1000),
        active: true,
        txHash: log.transactionHash,
      },
      update: {},
    })
  }

  private async handleUnstaked(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    const stakeId = Number(args.stakeId ?? 0)
    const wallet = (args.user as string).toLowerCase()

    // Find and deactivate the matching position
    await this.prisma.stakingPosition.updateMany({
      where: { wallet, stakeId, active: true },
      data: { active: false },
    })
  }

  private async handleStakingRewardClaimed(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    const wallet = (args.user as string).toLowerCase()
    await this.ensureUser(wallet)

    await this.prisma.rewardClaim.upsert({
      where: { txHash: log.transactionHash },
      create: {
        wallet,
        type: 'STAKING',
        amount: formatUnits(args.amount ?? 0n, 18),
        txHash: log.transactionHash,
        claimedAt: new Date(),
      },
      update: {},
    })
  }

  private async handleMFPGranted(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    const wallet = (args.to as string).toLowerCase()
    const grantedBy = (args.grantedBy as string).toLowerCase()
    const amount = Number(args.amount ?? 0)
    const source = Number(args.source ?? 0)

    await this.ensureUser(wallet)

    await this.prisma.mfpGrant.upsert({
      where: { txHash: log.transactionHash },
      create: {
        wallet,
        amount,
        source,
        grantedBy,
        txHash: log.transactionHash,
        blockNumber: Number(log.blockNumber),
      },
      update: {},
    })
  }

  private async handleMFPRevoked(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    // Record revoke as a negative-amount grant for audit trail
    const wallet = (args.from as string).toLowerCase()
    const revokedBy = (args.revokedBy as string).toLowerCase()
    const amount = Number(args.amount ?? 0)

    await this.prisma.mfpGrant.upsert({
      where: { txHash: log.transactionHash },
      create: {
        wallet,
        amount: -amount, // negative amount marks revoke
        source: 1,
        grantedBy: revokedBy,
        note: 'REVOKE',
        txHash: log.transactionHash,
        blockNumber: Number(log.blockNumber),
      },
      update: {},
    })
  }

  private async handleMFPMinted(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    const wallet = (args.to as string).toLowerCase()
    await this.ensureUser(wallet)

    const tokenId = Number(args.tokenId ?? 0)
    const imageId = Number(args.imageId ?? 0)
    const verseId = Number(args.verseId ?? 0)
    const tokenIdStr = tokenId.toString()

    // Track in NFTItem (existing model — keeps integration with rest of API)
    await this.prisma.nFTItem.upsert({
      where: { contractType_tokenId: { contractType: 'MFP', tokenId: tokenIdStr } },
      create: {
        wallet,
        contractType: 'MFP',
        tokenId: tokenIdStr,
        mintTxHash: log.transactionHash,
        mintedAt: new Date(),
        active: true,
      },
      update: {},
    })

    // Track in MfpMintRecord (new model — pair data + history)
    if (tokenId > 0) {
      await this.prisma.mfpMintRecord.upsert({
        where: { tokenId },
        create: {
          wallet,
          tokenId,
          imageId,
          verseId,
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
        },
        update: {},
      })
    }

    // Increment MFP count
    await this.prisma.user.update({
      where: { wallet },
      data: { mfpCount: { increment: 1 } },
    })
  }

  private async handleRoyaltyReceiverUpdated(args: Record<string, any>): Promise<void> {
    const newReceiver = (args.newReceiver as string).toLowerCase()
    await this.prisma.systemConfig.upsert({
      where: { key: 'mfp_royalty_receiver' },
      create: { key: 'mfp_royalty_receiver', value: newReceiver },
      update: { value: newReceiver },
    })
  }

  private async handleMFPBatchMinted(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    const wallet = (args.to as string).toLowerCase()
    await this.ensureUser(wallet)

    const startId = Number(args.startTokenId ?? 0)
    const count = Number(args.count ?? args.amount ?? 0)

    for (let i = 0; i < count; i++) {
      const tokenId = (startId + i).toString()
      await this.prisma.nFTItem.upsert({
        where: { contractType_tokenId: { contractType: 'MFP', tokenId } },
        create: {
          wallet,
          contractType: 'MFP',
          tokenId,
          mintTxHash: log.transactionHash,
          mintedAt: new Date(),
          active: true,
        },
        update: {},
      })
    }

    await this.prisma.user.update({
      where: { wallet },
      data: { mfpCount: { increment: count } },
    })
  }

  private async handleCommunityNFTMinted(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    const wallet = (args.to as string).toLowerCase()
    await this.ensureUser(wallet)

    const TIER_NAMES: Record<number, string> = { 1: 'Builder', 2: 'Maker', 3: 'Luminary' }
    const TIER_DURATIONS: Record<number, number> = { 1: 90, 2: 180, 3: 360 }

    const tierId = Number(args.tier ?? args.id ?? 1)
    const tokenId = (args.instanceId ?? args.tokenId ?? 0).toString()
    const durationDays = TIER_DURATIONS[tierId] ?? 90

    await this.prisma.nFTItem.upsert({
      where: { contractType_tokenId: { contractType: 'COMMUNITY', tokenId } },
      create: {
        wallet,
        contractType: 'COMMUNITY',
        tokenId,
        tier: TIER_NAMES[tierId] ?? 'Builder',
        mintTxHash: log.transactionHash,
        mintedAt: new Date(),
        expiresAt: new Date(Date.now() + durationDays * 86400 * 1000),
        active: true,
      },
      update: {},
    })
  }

  private async handleReferrerSet(args: Record<string, any>): Promise<void> {
    const user = (args.user as string).toLowerCase()
    const referrer = (args.referrer as string).toLowerCase()

    await this.ensureUser(user)
    try {
      await this.prisma.user.update({
        where: { wallet: user },
        data: { referrer },
      })
    } catch {
      // User may not exist yet — that's OK
    }
  }

  private async handleReferralReward(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    const wallet = (args.referrer as string).toLowerCase()
    await this.ensureUser(wallet)

    await this.prisma.rewardClaim.upsert({
      where: { txHash: log.transactionHash },
      create: {
        wallet,
        type: 'REFERRAL_RESERVE',
        amount: formatUnits(args.amount ?? 0n, 6), // USDT
        txHash: log.transactionHash,
        claimedAt: new Date(),
      },
      update: {},
    })
  }

  private async handleProposalCreated(args: Record<string, any>, log: Log | EventLog): Promise<void> {
    const proposalId = Number(args.proposalId ?? 0)
    const CATEGORIES: Record<number, string> = { 0: 'PARAMETER', 1: 'BUDGET', 2: 'STRUCTURAL', 3: 'EMERGENCY' }

    await this.prisma.dAOProposal.upsert({
      where: { proposalId },
      create: {
        proposalId,
        proposer: (args.proposer as string).toLowerCase(),
        title: args.title ?? '',
        description: args.description ?? '',
        category: CATEGORIES[Number(args.category ?? 0)] ?? 'PARAMETER',
        status: 'PENDING',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 86400 * 1000), // default 7 days
      },
      update: {},
    })
  }

  private async handleProposalApproved(args: Record<string, any>): Promise<void> {
    const proposalId = Number(args.proposalId ?? 0)
    await this.prisma.dAOProposal.updateMany({
      where: { proposalId },
      data: { status: 'PASSED' },
    })
  }

  private async handleProposalExecuted(args: Record<string, any>): Promise<void> {
    const proposalId = Number(args.proposalId ?? 0)
    await this.prisma.dAOProposal.updateMany({
      where: { proposalId },
      data: { status: 'EXECUTED', executedAt: new Date() },
    })
  }

  // ── Utility: Ensure User Exists ────────────────────────────────

  private async ensureUser(wallet: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { wallet } })
    if (!existing) {
      try {
        await this.prisma.user.create({
          data: {
            wallet,
            userId: `user_${wallet.slice(2, 10).toLowerCase()}`,
            termsAccepted: false,
          },
        })
      } catch {
        // Race condition — another poll may have inserted. Safe to ignore.
      }
    }
  }

  // ── Event Mappings ─────────────────────────────────────────────

  private getEventMappings(): EventMapping[] {
    return [
      {
        contractName: 'MICToken',
        contract: this.blockchain.micToken,
        events: ['Transfer', 'MiningMinted'],
      },
      {
        contractName: 'SeedSale',
        contract: this.blockchain.seedSale,
        events: ['SeedPurchase'],
      },
      {
        contractName: 'PreSale',
        contract: this.blockchain.preSale,
        events: ['PreSalePurchase'],
      },
      {
        contractName: 'MICELicense',
        contract: this.blockchain.miceLicense,
        events: ['LicensePurchased'],
      },
      {
        contractName: 'NFTStaking',
        contract: this.blockchain.nftStaking,
        events: ['Staked', 'Unstaked', 'RewardClaimed'],
      },
      {
        contractName: 'EmissionController',
        contract: this.blockchain.emissionController,
        events: ['DailyDistributed'],
      },
      {
        contractName: 'ReferralRegistry',
        contract: this.blockchain.referralRegistry,
        events: ['ReferrerSet', 'RewardDistributed'],
      },
      {
        contractName: 'DAOGovernor',
        contract: this.blockchain.daoGovernor,
        events: ['ProposalCreated', 'ProposalApproved', 'ProposalExecuted'],
      },
      {
        contractName: 'RevenueRouter',
        contract: this.blockchain.revenueRouter,
        events: ['RevenueDistributed'],
      },
      {
        contractName: 'MFPNFT',
        contract: this.blockchain.mfpNFT,
        events: ['MFPGranted', 'MFPRevoked', 'MFPMinted', 'RoyaltyReceiverUpdated'],
      },
      {
        contractName: 'CommunityNFT',
        contract: this.blockchain.communityNFT,
        events: ['CommunityNFTMinted'],
      },
    ]
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Converts ethers Result (positional + named) into a plain key-value object,
 * serializing BigInts as strings for JSON storage.
 */
function logArgsToObject(
  args: any,
  iface: Interface,
  eventName: string
): Record<string, any> {
  const result: Record<string, any> = {}

  try {
    const fragment = iface.getEvent(eventName)
    if (fragment) {
      for (let i = 0; i < fragment.inputs.length; i++) {
        const key = fragment.inputs[i].name || `arg${i}`
        const val = args[i]
        result[key] = typeof val === 'bigint' ? val.toString() : val
      }
    }
  } catch {
    // Fallback: iterate positional args
    for (let i = 0; i < args.length; i++) {
      const val = args[i]
      result[`arg${i}`] = typeof val === 'bigint' ? val.toString() : val
    }
  }

  return result
}

function isDuplicateError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes('Unique constraint') || err.message.includes('duplicate key')
  }
  return false
}
