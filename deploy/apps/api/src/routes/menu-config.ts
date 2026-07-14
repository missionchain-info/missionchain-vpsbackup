import { FastifyPluginAsync } from 'fastify'

/**
 * Public endpoint for frontend to fetch menu configuration.
 * No authentication required — returns the current menu state.
 *
 * The menu config is stored in SystemConfig with key = 'frontend-menu-config'
 * Value is a JSON string containing an array of menu items.
 */

// Default menu items — used when no config exists in DB yet
const DEFAULT_MENU_ITEMS = [
  { id: 'dashboard', icon: '📊', label: 'Dashboard', href: '/dashboard', group: 'Overview', status: 'enabled', mandatory: true, order: 0 },
  { id: 'profile', icon: '👤', label: 'Profile', href: '/profile', group: 'Overview', status: 'enabled', mandatory: true, order: 1 },
  { id: 'dao', icon: '🏛', label: 'DAO Governance', href: '/dao', group: 'Overview', status: 'disabled', mandatory: false, order: 2 },
  { id: 'seed', icon: '🌱', label: 'SEED Sale', href: '/seed', group: 'Token Sales', status: 'enabled', mandatory: false, order: 3, badge: 'HOT', roundType: 'SEED' },
  { id: 'presale', icon: '💰', label: 'Pre-Sale', href: '/presale', group: 'Token Sales', status: 'enabled', mandatory: false, order: 4, roundType: 'PRESALE' },
  { id: 'mice', icon: '🪪', label: 'MICE License', href: '/mice', group: 'Token Sales', status: 'enabled', mandatory: false, order: 5, roundType: 'MICE' },
  { id: 'mining', icon: '💎', label: 'Mining', href: '/mining', group: 'Earn', status: 'disabled', mandatory: false, order: 6 },
  { id: 'staking', icon: '📈', label: 'Staking', href: '/staking', group: 'Earn', status: 'disabled', mandatory: false, order: 7 },
  { id: 'network', icon: '🌐', label: 'Building', href: '/network', group: 'Earn', status: 'enabled', mandatory: false, order: 8 },
  { id: 'nft', icon: '🎨', label: 'NFT', href: '/nft', group: 'Earn', status: 'disabled', mandatory: false, order: 9 },
  { id: 'vesting', icon: '🔒', label: 'Vesting', href: '/vesting', group: 'Earn', status: 'disabled', mandatory: false, order: 10 },
  { id: 'p2p', icon: '🔀', label: 'P2P Exchange', href: '/p2p', group: 'Explore', status: 'disabled', mandatory: false, order: 11 },
  { id: 'swap', icon: '🔄', label: 'Swap', href: '/swap', group: 'Explore', status: 'disabled', mandatory: false, order: 12 },
  { id: 'info', icon: 'ℹ️', label: 'Infos', href: '/info', group: 'Explore', status: 'disabled', mandatory: false, order: 13 },
  { id: 'nira', icon: '🤖', label: 'NIRA AI', href: '/nira', group: 'Explore', status: 'disabled', mandatory: false, order: 14, badge: 'AI' },
]

const CONFIG_KEY = 'frontend-menu-config'

export const menuConfigRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /menu-config — Public: Get frontend menu configuration ───
  app.get('/', async (_req, reply) => {
    // Admin toggles must reach every device immediately — block all intermediate caches.
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate')
    reply.header('CDN-Cache-Control', 'no-store')
    reply.header('Cloudflare-CDN-Cache-Control', 'no-store')

    const config = await app.prisma.systemConfig.findUnique({
      where: { key: CONFIG_KEY },
    })

    if (!config) {
      return { data: DEFAULT_MENU_ITEMS }
    }

    try {
      const items = JSON.parse(config.value)

      // Auto-migrate: add any missing default items that don't exist in saved config
      let changed = false
      for (const def of DEFAULT_MENU_ITEMS) {
        if (!items.find((i: any) => i.id === def.id)) {
          items.push({ ...def })
          changed = true
        }
      }
      if (changed) {
        // Re-sort and persist the migrated config
        items.sort((a: any, b: any) => a.order - b.order)
        await app.prisma.systemConfig.update({
          where: { key: CONFIG_KEY },
          data: { value: JSON.stringify(items) },
        })
      }

      return { data: items }
    } catch {
      return { data: DEFAULT_MENU_ITEMS }
    }
  })
}
