// UI Constants
export const SIDEBAR_WIDTH = 260
export const SIDEBAR_COLLAPSED_WIDTH = 64
export const TOPBAR_HEIGHT = 64
export const MOBILE_NAV_HEIGHT = 64

// Breakpoints (match Tailwind)
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const

// Navigation structure
export const NAV_SECTIONS = [
  {
    label: 'OVERVIEW',
    items: [
      { name: 'Dashboard', path: '/', icon: 'LayoutDashboard' },
      { name: 'Profile', path: '/profile', icon: 'User' },
      { name: 'DAO', path: '/dao', icon: 'Building2' },
    ],
  },
  {
    label: 'TOKEN SALES',
    items: [
      { name: 'SEED Sale', path: '/seed', icon: 'Sprout' },
      { name: 'Pre-Sale', path: '/presale', icon: 'Rocket' },
      { name: 'MICE License', path: '/mice', icon: 'Pickaxe' },
    ],
  },
  {
    label: 'EARN',
    items: [
      { name: 'Mining', path: '/mining', icon: 'Gem' },
      { name: 'Staking', path: '/staking', icon: 'Layers' },
      { name: 'NFT Manager', path: '/nft', icon: 'Palette' },
      { name: 'Network', path: '/network', icon: 'Globe' },
      { name: 'Vesting', path: '/vesting', icon: 'Lock' },
    ],
  },
  {
    label: 'EXPLORE',
    items: [
      { name: 'Swap', path: '/swap', icon: 'ArrowLeftRight' },
      { name: 'Info', path: '/info', icon: 'Info' },
      { name: 'Documents', path: '/documents', icon: 'FileText' },
      { name: 'NIRA AI', path: '/nira', icon: 'Bot' },
    ],
  },
] as const

// Tokenomics
export const TOKENOMICS = {
  totalSupply: 7_000_000_000,
  preIssued: 1_050_000_000,
  miningPool: 5_950_000_000,
  seedPrice: 0.0025,
  presalePrice: 0.005,
  listingPrice: 0.01,
} as const
