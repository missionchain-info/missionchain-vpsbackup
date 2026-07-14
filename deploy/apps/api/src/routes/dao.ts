import { FastifyPluginAsync } from 'fastify'

export const daoRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /dao/overview — DAO dashboard summary ────────────────
  app.get('/overview', async () => {
    return {
      mfpStaked: 0,
      votingPower: '0%',
      activeProposals: 0,
      participation: '0%',
      proposals: [],
    }
  })

  // ─── GET /dao/proposals — List proposals (paginated) ───────────
  app.get('/proposals', async (req, reply) => {
    const { page: pageStr, limit: limitStr, status, category } = req.query as {
      page?: string
      limit?: string
      status?: string
      category?: string
    }

    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20))
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {}
    if (status) {
      const validStatuses = ['PENDING', 'ACTIVE', 'PASSED', 'REJECTED', 'EXECUTED']
      if (validStatuses.includes(status.toUpperCase())) {
        where.status = status.toUpperCase()
      }
    }
    if (category) {
      const validCategories = ['PARAMETER', 'BUDGET', 'STRUCTURAL', 'EMERGENCY']
      if (validCategories.includes(category.toUpperCase())) {
        where.category = category.toUpperCase()
      }
    }

    const [proposals, total] = await Promise.all([
      app.prisma.dAOProposal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          proposalId: true,
          proposer: true,
          title: true,
          category: true,
          status: true,
          forVotes: true,
          againstVotes: true,
          createdAt: true,
          expiresAt: true,
          executedAt: true,
        },
      }),
      app.prisma.dAOProposal.count({ where }),
    ])

    return {
      data: proposals.map((p) => ({
        ...p,
        forVotes: p.forVotes.toString(),
        againstVotes: p.againstVotes.toString(),
      })),
      pagination: { page, limit, total },
    }
  })

  // ─── GET /dao/proposals/:id — Single proposal with votes ──────
  app.get('/proposals/:id', async (req, reply) => {
    const { id } = req.params as { id: string }

    // Try by cuid first, then by proposalId (on-chain int)
    let proposal = await app.prisma.dAOProposal.findUnique({
      where: { id },
      include: {
        votes: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
      },
    })

    if (!proposal) {
      const proposalIdNum = parseInt(id, 10)
      if (!isNaN(proposalIdNum)) {
        proposal = await app.prisma.dAOProposal.findUnique({
          where: { proposalId: proposalIdNum },
          include: {
            votes: {
              orderBy: { createdAt: 'desc' },
              take: 100,
            },
          },
        })
      }
    }

    if (!proposal) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Proposal not found' })
    }

    const totalVotes = Number(proposal.forVotes) + Number(proposal.againstVotes)
    const forPct = totalVotes > 0 ? (Number(proposal.forVotes) / totalVotes) * 100 : 0

    return {
      data: {
        ...proposal,
        forVotes: proposal.forVotes.toString(),
        againstVotes: proposal.againstVotes.toString(),
        totalVotes: totalVotes.toString(),
        forPct: forPct.toFixed(2),
        votes: proposal.votes.map((v) => ({
          ...v,
          weight: v.weight.toString(),
        })),
      },
    }
  })

  // ─── GET /dao/votes — User voting history (auth) ──────────────
  app.get('/votes', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const { wallet: authWallet } = req.user as { wallet: string }
    const { wallet, page: pageStr, limit: limitStr } = req.query as {
      wallet?: string
      page?: string
      limit?: string
    }

    const targetWallet = (wallet ?? authWallet).toLowerCase()
    const { role } = req.user as { role: string }
    if (targetWallet !== authWallet && role !== 'ADMIN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Cannot view other users votes' })
    }

    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20))
    const skip = (page - 1) * limit

    const [votes, total] = await Promise.all([
      app.prisma.dAOVote.findMany({
        where: { wallet: targetWallet },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          proposal: {
            select: {
              proposalId: true,
              title: true,
              status: true,
              category: true,
            },
          },
        },
      }),
      app.prisma.dAOVote.count({ where: { wallet: targetWallet } }),
    ])

    return {
      data: votes.map((v) => ({
        ...v,
        weight: v.weight.toString(),
      })),
      pagination: { page, limit, total },
    }
  })

  // ─── GET /dao/stats — Governance stats ─────────────────────────
  app.get('/stats', async (req, reply) => {
    const [
      totalProposals,
      activeProposals,
      passedProposals,
      executedProposals,
      totalVotes,
      uniqueVoters,
    ] = await Promise.all([
      app.prisma.dAOProposal.count(),
      app.prisma.dAOProposal.count({ where: { status: 'ACTIVE' } }),
      app.prisma.dAOProposal.count({ where: { status: 'PASSED' } }),
      app.prisma.dAOProposal.count({ where: { status: 'EXECUTED' } }),
      app.prisma.dAOVote.count(),
      app.prisma.dAOVote.groupBy({ by: ['wallet'] }).then((r) => r.length),
    ])

    const participationRate = totalProposals > 0
      ? ((passedProposals + executedProposals) / totalProposals * 100).toFixed(2)
      : '0'

    return {
      data: {
        totalProposals,
        activeProposals,
        passedProposals,
        executedProposals,
        totalVotes,
        uniqueVoters,
        participationRate,
        governanceModel: 'DAOGovernor: Ban Thuong Truc 3/5 + >= 75% MFP staked weight',
        timelocks: {
          parameter: '24h',
          budget: '24h',
          structural: '7d',
          emergency: '0 (no timelock)',
        },
      },
    }
  })
}
