import { FastifyPluginAsync } from 'fastify'

/**
 * Public endpoint for frontend to fetch the NIRA avatar.
 * No authentication required — returns the avatar data URL from SystemConfig.
 * Avatar is stored by Admin via PUT /admin/system-config/nira-avatar
 */

const CONFIG_KEY = 'nira-avatar'

export const niraAvatarRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /nira-avatar — Public: Get NIRA avatar ─────────────────
  app.get('/', async () => {
    const config = await app.prisma.systemConfig.findUnique({
      where: { key: CONFIG_KEY },
    })

    if (!config || !config.value) {
      return { data: null }
    }

    return { data: config.value }
  })
}
