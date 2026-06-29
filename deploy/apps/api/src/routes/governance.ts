/**
 * GOVERNANCE — Web Frontend (DApp) endpoints for Steward Council members.
 *
 * Phase 2c-pivot (May 2, 2026): switched to on-chain reads from
 * SeedBudgetV5c (centralized vault) + OperationalSalaryPoolV3 (policy pool).
 * V5c/V3 cutover (Jun 23, 2026): replaces V5b/V2.
 *
 * All endpoints require JWT auth. Council membership is verified per-route.
 */
import { FastifyPluginAsync } from 'fastify'
import {
  readSeedBudgetAllSlots,
  readOperationalPoolAllMembers,
  readOperationalPoolMember,
  readSeedBudgetFee,
  readCurrentWeekIdx,
  readMgmtBonusState,
  readMgmtBonusVoteStatus,
  readMgmtBonusVoters,
  readMgmtBonusEvents,
  SLOT,
} from '../services/seedTreasury.js'
import { getActiveAddresses } from '@missionchain/sdk'
import { isOwnerWallet } from '../plugins/rbac.js'

export const governanceRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /governance/council/me — Check current wallet's council status ──
  app.get('/council/me', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const member = await app.prisma.stewardCouncilMember.findUnique({
      where: { wallet: wallet.toLowerCase() },
    })
    return reply.send({
      data: {
        isMember: !!member && member.active,
        member: member
          ? {
              memberId:   member.memberId,
              wallet:     member.wallet,
              role:       member.role,
              rightLabel: member.rightLabel,
              note:       member.note,
              active:     member.active,
              joinedAt:   member.createdAt,
            }
          : null,
      },
    })
  })

  // ─── GET /governance/council/members — All council members ──
  app.get('/council/members', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const me = await app.prisma.stewardCouncilMember.findUnique({
      where: { wallet: wallet.toLowerCase() },
    })
    if (!me || !me.active) {
      return reply.status(403).send({ error: 'NOT_COUNCIL', message: 'Council members only' })
    }

    const members = await app.prisma.stewardCouncilMember.findMany({
      orderBy: { createdAt: 'asc' },
    })
    return reply.send({
      data: members.map((m) => ({
        memberId:   m.memberId,
        wallet:     m.wallet,
        role:       m.role,
        rightLabel: m.rightLabel,
        note:       m.note,
        active:     m.active,
        joinedAt:   m.createdAt,
      })),
    })
  })

  // ─── GET /governance/funds-distribution/seed ───────────────────────────
  // On-chain reads from SeedBudgetV5c + OperationalSalaryPoolV3.
  app.get('/funds-distribution/seed', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const callerWallet = wallet.toLowerCase()

    const me = await app.prisma.stewardCouncilMember.findUnique({ where: { wallet: callerWallet } })
    if (!me || !me.active) {
      return reply.status(403).send({ error: 'NOT_COUNCIL', message: 'Council members only' })
    }

    try {
      const [slots, onChainMembers, weekIdx] = await Promise.all([
        readSeedBudgetAllSlots(),
        readOperationalPoolAllMembers(),
        readCurrentWeekIdx(),
      ])

      // Hydrate on-chain members with DB metadata (memberId, role, active flag)
      const councilMembers = await app.prisma.stewardCouncilMember.findMany()
      const councilByWallet = new Map(councilMembers.map((c) => [c.wallet.toLowerCase(), c]))

      const operational = slots.operational
      const totalClaimable = onChainMembers.reduce((s, m) => s + m.claimable, 0)
      const totalShareBps = onChainMembers.reduce((s, m) => s + m.sharePctBps, 0)

      return reply.send({
        data: {
          round: 'SEED',
          active: true,
          totalShareBps,
          totalReceived:   operational.totalReceived,
          totalClaimed:    operational.totalReleased,
          totalClaimable,
          weekIdx,
          members: onChainMembers.map((m) => {
            const c = councilByWallet.get(m.wallet)
            return {
              memberId:           c?.memberId ?? '?',
              wallet:             m.wallet,
              role:               c?.role ?? '',
              active:             c?.active ?? true,
              sharePctBps:        m.sharePctBps,
              weeklyMaxoutUsdt:   m.weeklyMaxoutUsdt,
              totalReceived:      (operational.totalReceived * m.sharePctBps) / 10_000,
              totalClaimed:       m.totalClaimed,
              claimable:          m.claimable,
              allocatedThisWeek:  m.allocatedThisWeek,
              isMe:               m.wallet === callerWallet,
            }
          }),
        },
      })
    } catch (e: any) {
      app.log.error({ err: e?.message }, 'funds-distribution/seed on-chain read failed')
      return reply.status(502).send({ error: 'CHAIN_ERROR', message: 'Failed to read on-chain treasury state' })
    }
  })

  // ─── GET /governance/funds-distribution/presale ─ greyed (Phase 2c+)
  app.get('/funds-distribution/presale', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({ data: { round: 'PRE_SALE', active: false, message: 'Coming in Phase 2c' } })
  })

  // ─── GET /governance/funds-distribution/mice ─ greyed (Phase 2c+)
  app.get('/funds-distribution/mice', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({ data: { round: 'MICE', active: false, message: 'Coming in Phase 2c' } })
  })

  // ─── GET /governance/funds-distribution/seed/claim-info ────────────────
  // Returns the on-chain contract + ABI + amount info needed for FE to
  // build a wallet-signed claim() call.
  app.get('/funds-distribution/seed/claim-info', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const callerWallet = wallet.toLowerCase()

    const me = await app.prisma.stewardCouncilMember.findUnique({ where: { wallet: callerWallet } })
    if (!me || !me.active) {
      return reply.status(403).send({ error: 'NOT_COUNCIL', message: 'Council members only' })
    }

    try {
      const onChain = await readOperationalPoolMember(callerWallet)
      const fee = await readSeedBudgetFee()
      return reply.send({
        data: {
          contract: getActiveAddresses().OperationalSalaryPoolV3,
          method: 'claim',
          claimable: onChain?.claimable ?? 0,
          enrolled:  onChain?.enrolled ?? false,
          feeBps:    fee.feeBps,
          message: onChain?.enrolled
            ? `Sign and submit claim() to receive ${onChain.claimable} USDT (less ${fee.feeBps / 100}% fee).`
            : 'Wallet is not enrolled in OperationalSalaryPoolV3',
        },
      })
    } catch (e: any) {
      app.log.error({ err: e?.message }, 'claim-info on-chain read failed')
      return reply.status(502).send({ error: 'CHAIN_ERROR', message: 'Failed to read on-chain pool state' })
    }
  })

  // ─── POST /governance/funds-distribution/seed/claim ────────────────────
  // After FE calls OperationalSalaryPoolV3.claim() on-chain, FE posts the
  // txHash here so we record claim history + audit trail in DB.
  app.post('/funds-distribution/seed/claim', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const callerWallet = wallet.toLowerCase()
    const body = req.body as { txHash?: string; amountUsdt?: number }

    if (!body.txHash || body.txHash.length < 10) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'txHash required' })
    }

    const me = await app.prisma.stewardCouncilMember.findUnique({ where: { wallet: callerWallet } })
    if (!me || !me.active) {
      return reply.status(403).send({ error: 'NOT_COUNCIL', message: 'Council members only' })
    }

    // Verify on-chain
    let amount = body.amountUsdt ?? 0
    try {
      const { ethers } = await import('ethers')
      const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/')
      const tx = await provider.getTransaction(body.txHash)
      const receipt = await provider.getTransactionReceipt(body.txHash)
      if (!tx || !receipt || receipt.status !== 1) {
        return reply.status(400).send({ error: 'TX_FAILED', message: 'Transaction not found or reverted' })
      }
      // Trust amount sent by FE; on-chain Claimed event verification can be added later
    } catch (e: any) {
      app.log.warn({ err: e?.message }, 'claim verify failed')
    }

    // Idempotent
    const existing = await app.prisma.operationalPoolClaim.findFirst({ where: { txHash: body.txHash } })
    if (existing) {
      return reply.send({ data: { claimId: existing.id, alreadyRecorded: true } })
    }

    const claim = await app.prisma.operationalPoolClaim.create({
      data: {
        wallet:     callerWallet,
        amountUsdt: amount,
        txHash:     body.txHash,
      },
    })

    return reply.send({
      data: {
        claimId:    claim.id,
        amountUsdt: amount,
        txHash:     body.txHash,
        message:    'Claim recorded.',
      },
    })
  })

  // ─── GET /governance/my-activity ───
  app.get('/my-activity', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const callerWallet = wallet.toLowerCase()

    const me = await app.prisma.stewardCouncilMember.findUnique({ where: { wallet: callerWallet } })
    if (!me || !me.active) {
      return reply.status(403).send({ error: 'NOT_COUNCIL', message: 'Council members only' })
    }

    const claims = await app.prisma.operationalPoolClaim.findMany({
      where: { wallet: callerWallet },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return reply.send({
      data: {
        memberId: me.memberId,
        joinedAt: me.createdAt,
        claims: claims.map((c) => ({
          id:          c.id,
          amountUsdt:  Number(c.amountUsdt),
          txHash:      c.txHash,
          createdAt:   c.createdAt,
        })),
        votes:     [],
        proposals: [],
      },
    })
  })

  // ─── GET /governance/treasury/overview — Live on-chain pool balances ─────
  app.get('/treasury/overview', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const me = await app.prisma.stewardCouncilMember.findUnique({ where: { wallet: wallet.toLowerCase() } })
    if (!me || !me.active) {
      return reply.status(403).send({ error: 'NOT_COUNCIL', message: 'Council members only' })
    }

    try {
      const slots = await readSeedBudgetAllSlots()
      const callerWallet = wallet.toLowerCase()
      const meOnChain = await readOperationalPoolMember(callerWallet).catch(() => null)

      return reply.send({
        data: {
          seedOperational: {
            totalReceived:  slots.operational.totalReceived,
            totalClaimed:   slots.operational.totalReleased,
            totalClaimable: meOnChain?.claimable ?? 0,
            balance:        slots.operational.balance,
          },
          seedDistribution: {
            totalReceived:  slots.distribution.totalReceived,
            totalClaimed:   slots.distribution.totalReleased,
            balance:        slots.distribution.balance,
          },
          seedManagementBonus: {
            totalReceived:  slots.mgmtBonus.totalReceived,
            totalClaimed:   slots.mgmtBonus.totalReleased,
            balance:        slots.mgmtBonus.balance,
          },
          seedReserved: {
            totalReceived:  slots.reserved.totalReceived,
            totalClaimed:   slots.reserved.totalReleased,
            balance:        slots.reserved.balance,
          },
          presale:             { active: false, status: 'phase-2c' },
          mice:                { active: false, status: 'phase-2c' },
        },
      })
    } catch (e: any) {
      app.log.error({ err: e?.message }, 'treasury/overview on-chain read failed')
      return reply.status(502).send({ error: 'CHAIN_ERROR', message: 'Failed to read on-chain treasury state' })
    }
  })

  // ─── GET /governance/proposals — Council bonus order list ────────────────
  // Reads ManagementBonusPoolV3 state on-chain. Hydrates requester/recipient
  // with DB metadata (memberId for council members + label for non-members).
  // Adds myVote flag for the calling council member, and `executable` flag
  // (status==PENDING && ratio >= threshold && slotBalance >= amount).
  app.get('/proposals', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const callerWallet = wallet.toLowerCase()

    const me = await app.prisma.stewardCouncilMember.findUnique({ where: { wallet: callerWallet } })
    if (!me || !me.active) {
      return reply.status(403).send({ error: 'NOT_COUNCIL', message: 'Council members only' })
    }

    try {
      const [state, councilMembers] = await Promise.all([
        readMgmtBonusState(),
        app.prisma.stewardCouncilMember.findMany(),
      ])

      // Event scan is best-effort — public BSC RPC may rate-limit or have
      // pruned history. If it fails, return state without tx hashes (graceful
      // degradation). UI shows orders + actions, just without BSCScan links.
      let events: Awaited<ReturnType<typeof readMgmtBonusEvents>> = {
        createdTx: new Map(), executedTx: new Map(),
        cancelledTx: new Map(), voteTxBy: new Map(),
      }
      try {
        events = await readMgmtBonusEvents()
      } catch (e: any) {
        app.log.warn({ err: e?.message }, '/proposals event scan failed; continuing without tx hashes')
      }

      const councilByWallet = new Map(councilMembers.map((c) => [c.wallet.toLowerCase(), c]))

      // Look up labels for any non-council recipients (e.g. external wallets
      // could still be registered Users; we hydrate by userId/walletShort fallback)
      const externalWallets = Array.from(
        new Set(
          state.orders
            .flatMap((o) => [o.recipient, o.requester])
            .filter((w) => !councilByWallet.has(w)),
        ),
      )
      const externalUsers = externalWallets.length > 0
        ? await app.prisma.user.findMany({
            where: { wallet: { in: externalWallets } },
            select: { wallet: true, userId: true },
          })
        : []
      const externalByWallet = new Map(externalUsers.map((u) => [u.wallet.toLowerCase(), u.userId]))

      const labelOf = (w: string) => {
        const c = councilByWallet.get(w)
        if (c) return { label: c.memberId, type: 'council' as const }
        const uid = externalByWallet.get(w)
        if (uid) return { label: uid, type: 'user' as const }
        return { label: `${w.slice(0, 6)}…${w.slice(-4)}`, type: 'external' as const }
      }

      // Per-order myVote flag — only for PENDING orders (saves RPC calls)
      const myVotes = await Promise.all(
        state.orders.map((o) =>
          o.status === 'PENDING'
            ? readMgmtBonusVoteStatus(o.id, callerWallet)
            : Promise.resolve(false),
        ),
      )

      const enriched = state.orders.map((o, i) => {
        const requesterMeta = labelOf(o.requester)
        const recipientMeta = labelOf(o.recipient)
        const executable =
          o.status === 'PENDING' &&
          o.approvalRatioBps >= state.thresholdBps &&
          state.slotBalance >= o.amount
        return {
          id:                o.id,
          recipient:         o.recipient,
          recipientLabel:    recipientMeta.label,
          recipientType:     recipientMeta.type,
          amount:            o.amount,
          content:           o.content,
          requester:         o.requester,
          requesterLabel:    requesterMeta.label,
          requesterType:     requesterMeta.type,
          createdAt:         o.createdAt,
          status:            o.status,
          executedAt:        o.executedAt,
          approvalsCount:    o.approvalsCount,
          approvalRatioBps:  o.approvalRatioBps,
          executable,
          myVote:            myVotes[i],
          createdTxHash:     events.createdTx.get(o.id) ?? null,
          executedTxHash:    events.executedTx.get(o.id) ?? null,
          cancelledTxHash:   events.cancelledTx.get(o.id) ?? null,
          myVoteTxHash:      events.voteTxBy.get(`${o.id}-${callerWallet}`) ?? null,
        }
      })

      return reply.send({
        data: {
          thresholdBps:       state.thresholdBps,
          activeCouncilCount: state.activeCouncilCount,
          slotBalance:        state.slotBalance,
          callerWallet,
          callerIsOwner:      isOwnerWallet(callerWallet),
          orders:             enriched,
        },
      })
    } catch (e: any) {
      app.log.error({ err: e?.message }, '/proposals on-chain read failed')
      return reply.status(502).send({ error: 'CHAIN_ERROR', message: 'Failed to read proposals from chain' })
    }
  })

  // ─── GET /governance/proposals/:id/voters — Voters list for an order ─────
  app.get('/proposals/:id/voters', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { wallet } = req.user as { wallet: string }
    const me = await app.prisma.stewardCouncilMember.findUnique({ where: { wallet: wallet.toLowerCase() } })
    if (!me || !me.active) {
      return reply.status(403).send({ error: 'NOT_COUNCIL', message: 'Council members only' })
    }

    const { id } = req.params as { id: string }
    const orderId = parseInt(id, 10)
    if (isNaN(orderId) || orderId < 1) {
      return reply.status(400).send({ error: 'BAD_REQUEST', message: 'Invalid order id' })
    }

    try {
      const council = await app.prisma.stewardCouncilMember.findMany({ where: { active: true } })
      const wallets = council.map((c) => c.wallet)
      const voted = await readMgmtBonusVoters(orderId, wallets)
      const votedSet = new Set(voted.map((w) => w.toLowerCase()))
      return reply.send({
        data: council.map((c) => ({
          memberId: c.memberId,
          wallet:   c.wallet,
          role:     c.role,
          voted:    votedSet.has(c.wallet.toLowerCase()),
        })),
      })
    } catch (e: any) {
      app.log.error({ err: e?.message, orderId }, '/proposals/:id/voters failed')
      return reply.status(502).send({ error: 'CHAIN_ERROR', message: 'Failed to read voters' })
    }
  })
}
