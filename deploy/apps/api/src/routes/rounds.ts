import { FastifyPluginAsync } from 'fastify'

/**
 * PUBLIC round config endpoints — no auth required.
 * Frontend reads these to decide which rounds are Active / Pending / Inactive.
 */
export const roundsRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /rounds/config — All round configs (public) ────────────
  app.get('/config', async () => {
    const rounds = await app.prisma.roundConfig.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        roundType: true,
        status: true,
        displayCap: true,
        totalSold: true,
        countdownStart: true,
        countdownEnd: true,
        unsoldAction: true,
        micPrice: true,
        updatedAt: true,
      },
    })

    return {
      data: rounds.map((r) => ({
        roundType: r.roundType,
        status: r.status,
        displayCap: r.displayCap?.toString() ?? null,
        totalSold: r.totalSold.toString(),
        countdownStart: r.countdownStart?.toISOString() ?? null,
        countdownEnd: r.countdownEnd?.toISOString() ?? null,
        unsoldAction: r.unsoldAction,
        micPrice: r.micPrice?.toString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
      })),
    }
  })

  // ─── GET /rounds/config/:roundType — Single round config (public) ─
  app.get('/config/:roundType', async (req, reply) => {
    const { roundType } = req.params as { roundType: string }

    const round = await app.prisma.roundConfig.findUnique({
      where: { roundType: roundType.toUpperCase() },
    })

    if (!round) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Round not found' })
    }

    return {
      data: {
        roundType: round.roundType,
        status: round.status,
        displayCap: round.displayCap?.toString() ?? null,
        totalSold: round.totalSold.toString(),
        countdownStart: round.countdownStart?.toISOString() ?? null,
        countdownEnd: round.countdownEnd?.toISOString() ?? null,
        unsoldAction: round.unsoldAction,
        micPrice: round.micPrice?.toString() ?? null,
        notes: round.notes,
        updatedAt: round.updatedAt.toISOString(),
      },
    }
  })

  // ─── GET /rounds/mic-price — Current MIC price (public) ──────────
  app.get('/mic-price', async () => {
    // First check if swap is enabled (use DEX price)
    const swapConfig = await app.prisma.systemConfig.findUnique({
      where: { key: 'swap_enabled' },
    })

    const priceMode = await app.prisma.systemConfig.findUnique({
      where: { key: 'mic_price_mode' },
    })

    const adminPrice = await app.prisma.systemConfig.findUnique({
      where: { key: 'mic_price' },
    })

    const isSwapEnabled = swapConfig?.value === 'true'
    const mode = priceMode?.value ?? 'admin'

    if (isSwapEnabled && mode === 'twap') {
      // TODO: Fetch from PancakeSwap TWAP oracle
      return {
        data: {
          price: null,
          source: 'twap',
          note: 'TWAP oracle not yet configured',
        },
      }
    }

    return {
      data: {
        price: adminPrice?.value ?? '0.0085',
        source: 'admin',
        swapEnabled: isSwapEnabled,
      },
    }
  })

  // ─── GET /rounds/system-info — Public system info ─────────────────
  app.get('/system-info', async () => {
    const configs = await app.prisma.systemConfig.findMany({
      where: {
        key: {
          in: ['swap_enabled', 'mic_price', 'mic_price_mode', 'p2p_enabled', 'p2p-config'],
        },
      },
    })

    const configMap = Object.fromEntries(configs.map((c) => [c.key, c.value]))

    // Parse p2p-config JSON to extract platformFee for FE display (fallback to 1.5)
    let p2pFee = '1.5'
    try {
      const p2pConfig = configMap['p2p-config']
      if (p2pConfig) {
        const parsed = JSON.parse(p2pConfig)
        if (parsed.platformFee != null) p2pFee = String(parsed.platformFee)
      }
    } catch { /* ignore parse errors, use default */ }

    return {
      data: {
        swapEnabled: configMap['swap_enabled'] === 'true',
        micPrice: configMap['mic_price'] ?? '0.0085',
        micPriceMode: configMap['mic_price_mode'] ?? 'admin',
        p2pEnabled: configMap['p2p_enabled'] === 'true',
        p2pFee,
      },
    }
  })
}
