import 'dotenv/config'

// Prevent unhandled rejections from crashing the process (e.g. RPC errors)
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason)
})

import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import jwt from '@fastify/jwt'
import prismaPlugin from './plugins/prisma'
import authPlugin from './plugins/auth'
import { authRoutes } from './routes/auth'
import { userRoutes } from './routes/user'
import { dashboardRoutes } from './routes/dashboard'
import { salesRoutes } from './routes/sales'
import { stakingRoutes } from './routes/staking'
import { miningRoutes } from './routes/mining'
import { miningNetworkRoutes } from './routes/mining-network'
import { nftRoutes } from './routes/nft'
import { referralRoutes } from './routes/referral'
import { vestingRoutes } from './routes/vesting'
import { daoRoutes } from './routes/dao'
import { adminRoutes } from './routes/admin'
import { distributorRoutes } from './routes/distributor'
import { oldInvestorsRoutes } from './routes/old-investors'
import { foundersRoutes } from './routes/founders'
import { nftRewardsRoutes } from './routes/nft-rewards.js'
import { communityGrantsAdminRoutes, communityGrantsUserRoutes } from './routes/community-grants.js'
import { stewardCouncilRoutes } from './routes/steward-council'
import { operationalPoolRoutes } from './routes/operational-pool'
import { mgmtOpsRoutes } from './routes/mgmt-ops'
import { governanceRoutes } from './routes/governance'
import { p2pRoutes } from './routes/p2p'
import p2pMicRoutes from './routes/p2p-mic'
import { roundsRoutes } from './routes/rounds'
import { menuConfigRoutes } from './routes/menu-config'
import { niraAvatarRoutes } from './routes/nira-avatar'
import { networkRoutes } from './routes/network'
import { componentsRoutes } from './routes/components'
import { telegramRoutes } from './routes/telegram'
import { BlockchainService } from './services/blockchain'
import { EventIndexer } from './services/indexer'
import { PreSaleEventSync } from './services/presaleEventSync'
import { SeedEventSync } from './services/seedEventSync'
import { P2PEventSync } from './services/p2pEventSync'
import { getActiveAddresses, getActiveChain } from '@missionchain/sdk'

// ─── Type Augmentation ───────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyInstance {
    blockchain: BlockchainService
  }
}

// ─── App Setup ───────────────────────────────────────────────────────

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    ...(process.env.NODE_ENV === 'development' && {
      transport: { target: 'pino-pretty' },
    }),
  },
  bodyLimit: 8 * 1024 * 1024, // 2MB — supports base64 avatar uploads
})

async function start() {
  // ── Core Plugins ─────────────────────────────────────────────────

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : ['http://localhost:3003', 'http://localhost:3004', 'http://localhost:3000'],
    credentials: true,
  })


  // ── Rate Limiting ────────────────────────────────────────────────

  await app.register(rateLimit, {
    global: true,
    max: 100,
    timeWindow: 60000,
    keyGenerator: (req) => req.headers['x-real-ip'] as string || req.ip,
  })

  await app.register(jwt, {
    secret: process.env.JWT_SECRET!,
  })

  // ── Database ─────────────────────────────────────────────────────

  await app.register(prismaPlugin)

  // ── Auth ─────────────────────────────────────────────────────────

  await app.register(authPlugin)

  // ── Blockchain Service ───────────────────────────────────────────

  const blockchain = new BlockchainService()
  app.decorate('blockchain', blockchain)
  app.log.info('BlockchainService initialized (RPC: %s)',
    process.env.INDEXER_RPC_URL || process.env.BSC_RPC_URL || 'testnet default')

  // ── Routes ───────────────────────────────────────────────────────

  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(userRoutes, { prefix: '/user' })
  await app.register(dashboardRoutes, { prefix: '/dashboard' })
  await app.register(salesRoutes, { prefix: '/sales' })
  await app.register(stakingRoutes, { prefix: '/staking' })
  await app.register(miningRoutes, { prefix: '/mining' })
  await app.register(miningNetworkRoutes, { prefix: '/mining' })
  await app.register(nftRoutes, { prefix: '/nft' })
  await app.register(communityGrantsUserRoutes, { prefix: '/nft' })
  await app.register(referralRoutes, { prefix: '/referral' })
  await app.register(vestingRoutes, { prefix: '/vesting' })
  await app.register(daoRoutes, { prefix: '/dao' })
  await app.register(adminRoutes, { prefix: '/admin' })
  await app.register(distributorRoutes, { prefix: '/admin/distributors' })
  await app.register(oldInvestorsRoutes, { prefix: '/admin/seed/old-investors' })
  await app.register(foundersRoutes, { prefix: '/admin/founders' })
  await app.register(nftRewardsRoutes, { prefix: '/admin/nft-rewards' })
  await app.register(communityGrantsAdminRoutes, { prefix: '/admin/community-grants' })
  await app.register(stewardCouncilRoutes, { prefix: '/admin/steward-council' })
  await app.register(operationalPoolRoutes, { prefix: '/admin/seed-budget/operational' })
  await app.register(mgmtOpsRoutes, { prefix: '/governance/mgmt-ops' })
  await app.register(governanceRoutes, { prefix: '/governance' })
  await app.register(p2pRoutes, { prefix: '/p2p' })
  await app.register(p2pMicRoutes, { prefix: '/p2p-mic' })
  await app.register(roundsRoutes, { prefix: '/rounds' })
  await app.register(menuConfigRoutes, { prefix: '/menu-config' })
  await app.register(niraAvatarRoutes, { prefix: '/nira-avatar' })
  await app.register(networkRoutes, { prefix: '/network' })
  await app.register(componentsRoutes, { prefix: '/components' })
  await app.register(telegramRoutes, { prefix: '/telegram' })

  // ── Health Check ─────────────────────────────────────────────────

  app.get('/health', async () => {
    let dbOk = false
    let blockchainOk = false

    try {
      await app.prisma.$queryRaw`SELECT 1`
      dbOk = true
    } catch { /* database unreachable */ }

    try {
      const block = await blockchain.getCurrentBlock()
      blockchainOk = block > 0
    } catch { /* RPC unreachable */ }

    return {
      status: dbOk && blockchainOk ? 'ok' : 'degraded',
      timestamp: Date.now(),
      services: {
        database: dbOk,
        blockchain: blockchainOk,
      },
    }
  })

  // ── Start Server ─────────────────────────────────────────────────

  const port = Number(process.env.PORT) || 4000
  const host = process.env.HOST || '0.0.0.0'
  await app.listen({ port, host })
  app.log.info(`API running at http://${host}:${port}`)

  // ── Start Old Investors auto-execute cron (server-side relayer) ──
  // Polls every 60s for PENDING requests with elapsed cooldownEnd, executes
  // them on-chain via DEPLOYER_PK wallet. Disabled if DEPLOYER_PK missing.
  if (process.env.DEPLOYER_PK) {
    const { startOldInvestorCron } = await import('./services/oldInvestorRelayer.js')
    startOldInvestorCron(app, 60_000)
    const { startFounderCron } = await import('./services/founderRelayer.js')
    startFounderCron(app, 60_000)
  } else {
    app.log.warn('OldInvestor + Founder cron NOT started (DEPLOYER_PK not configured)')
  }

  // ── Mining keeper ────────────────────────────────────────────────
  // Nothing in the mining layer runs on its own: a day's emission that nobody asks for
  // is not deferred, it is destroyed. Uses KEEPER_PK, deliberately not DEPLOYER_PK —
  // a wallet that signs every ten minutes must not also hold admin authority.
  if (process.env.KEEPER_PK) {
    const { startMiningKeeper } = await import('./services/miningKeeper.js')
    startMiningKeeper(app, Number(process.env.MINING_KEEPER_MS) || 600_000)

    // Turns pool balances into individual entitlements: notifies the two MIC pools after
    // each daily emission, and credits the weekly and monthly USDT pools when a period
    // closes. Without it the USDT accumulates while every holder's claimable stays zero.
    const { startRewardKeeper } = await import('./services/rewardKeeper.js')
    startRewardKeeper(app, Number(process.env.REWARD_KEEPER_MS) || 3_600_000)
  } else {
    app.log.warn('miningKeeper NOT started (KEEPER_PK not configured) — no daily emission will be minted')
  }

  // ── Start Event Indexer (background) ─────────────────────────────

  if (process.env.DISABLE_INDEXER !== 'true') {
    const indexer = new EventIndexer({
      prisma: app.prisma,
      blockchain,
      pollIntervalMs: Number(process.env.INDEXER_POLL_MS) || 15_000,
    })
    indexer.start()

    // Graceful shutdown
    const shutdown = async () => {
      app.log.info('Shutting down...')
      indexer.stop()
      await app.close()
      process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }

  // Resolve once — applies to all event-sync workers below.
  const addr = getActiveAddresses()
  const chain = getActiveChain()
  const defaultRpc = chain.rpcUrls[0]
  app.log.info(`[chain] Active network=${chain.network} (chainId ${chain.chainId})`)

  // ── Start PreSale Event Sync (lightweight, always on) ────────────
  // Safety net: backfill on-chain PreSale purchases that FE failed to record.
  // Runs even when full EventIndexer is disabled.
  const presaleAddr = addr.PreSale
  if (presaleAddr && presaleAddr !== '0x0000000000000000000000000000000000000000') {
    const presaleSync = new PreSaleEventSync(
      app.prisma,
      presaleAddr,
      // getLogs is the first thing the public endpoints fail at.
      process.env.INDEXER_RPC_URL || process.env.BSC_RPC_URL || defaultRpc,
    )
    presaleSync.start()
  } else {
    app.log.warn('PreSale event sync NOT started (PreSale not deployed on active network)')
  }

  // ── Start SeedSale Event Sync (Phase 2c-pivot) ───────────────────
  const seedSaleAddr = addr.SeedSale
  if (seedSaleAddr && seedSaleAddr !== '0x0000000000000000000000000000000000000000') {
    const seedSync = new SeedEventSync(
      app.prisma,
      seedSaleAddr,
      process.env.INDEXER_RPC_URL || process.env.BSC_RPC_URL || defaultRpc,
    )
    seedSync.start()
  } else {
    app.log.warn('SeedSale event sync NOT started (SeedSale not deployed on active network)')
  }

  // ── Start P2P Event Sync (Task 12) ───────────────────────────────
  // Polls the MFP-NFT escrow's events every 30s; upserts P2POrder DB rows.
  // Repointed to P2PEscrowNFT_MFP on 2026-08-12; the old P2PEscrowMFP could never take an
  // order, so there is no history on it to miss.
  const p2pAddr = addr.P2PEscrowNFT_MFP
  const p2pCfg = await app.prisma.systemConfig.findUnique({ where: { key: 'p2p_enabled' } }).catch(() => null)
  const p2pEnabled = p2pCfg?.value === 'true'
  if (p2pAddr && p2pAddr !== '0x0000000000000000000000000000000000000000' && p2pEnabled) {
    const p2pSync = new P2PEventSync(app.prisma, app.log)
    await p2pSync.start()
  } else if (!p2pEnabled) {
    app.log.info('P2P event sync NOT started (p2p_enabled=false - feature disabled)')
  } else {
    app.log.warn('P2P event sync NOT started (P2PEscrowNFT_MFP not deployed on active network)')
  }
}

start().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
