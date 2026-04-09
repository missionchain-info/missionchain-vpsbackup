export interface NavItem {
  icon: string;
  label: string;
  href: string;
  badge?: string;
  badgeClass?: string;
}

export interface SidebarSection {
  title: string;
  items: NavItem[];
}

export const sidebarConfig: Record<string, SidebarSection[]> = {
  core: [
    { title: 'OVERVIEW', items: [
      { icon: '🔗', label: 'Dashboard', href: '/core' },
    ]},
    { title: 'USERS', items: [
      { icon: '👥', label: 'User Management', href: '/core/users' },
      { icon: '🪪', label: 'KYC Review', href: '/core/kyc', badge: '14', badgeClass: '' },
    ]},
    { title: 'ADMIN', items: [
      { icon: '👑', label: 'Roles & Permissions', href: '/core/rbac' },
      { icon: '📋', label: 'Audit Log', href: '/core/audit' },
    ]},
    { title: 'SYSTEM', items: [
      { icon: '⚙️', label: 'Configuration', href: '/core/system' },
    ]},
  ],
  info: [
    { title: 'OVERVIEW', items: [
      { icon: '📄', label: 'Dashboard', href: '/info' },
    ]},
    { title: 'CONTENT', items: [
      { icon: '🌐', label: 'Landing Page CMS', href: '/info/landing' },
      { icon: '📑', label: 'Documents', href: '/info/documents' },
    ]},
    { title: 'LOCALIZATION', items: [
      { icon: '🌍', label: 'Translations', href: '/info/translations', badge: '2', badgeClass: '' },
    ]},
    { title: 'ANALYTICS', items: [
      { icon: '📊', label: 'SEO & Traffic', href: '/info/analytics' },
    ]},
  ],
  world: [
    { title: 'OVERVIEW', items: [
      { icon: '🌍', label: 'Dashboard', href: '/world' },
    ]},
    { title: 'SOPHIA KOL', items: [
      { icon: '✨', label: 'SOPHIA WORD', href: '/world/sophia-word', badge: '3', badgeClass: '' },
      { icon: '⚙️', label: 'SOPHIA Config', href: '/world/sophia-config' },
    ]},
    { title: 'COMMUNITY', items: [
      { icon: '🛡️', label: 'Moderation', href: '/world/moderation', badge: '7', badgeClass: '' },
      { icon: '🎯', label: 'Challenges', href: '/world/challenges' },
      { icon: '🛒', label: 'Marketplace', href: '/world/marketplace' },
    ]},
  ],
  apps: [
    { title: 'OVERVIEW', items: [
      { icon: '📊', label: 'Dashboard', href: '/apps' },
    ]},
    { title: 'TOKEN SALE', items: [
      { icon: '🌱', label: 'SEED Round', href: '/apps/seed', badge: 'OPEN', badgeClass: 'green' },
      { icon: '🚀', label: 'Pre-Sale', href: '/apps/presale' },
      { icon: '⚡', label: 'MICE License', href: '/apps/mice', badge: 'OPEN', badgeClass: 'green' },
    ]},
    { title: 'PROTOCOL', items: [
      { icon: '⛏️', label: 'Mining & Staking', href: '/apps/mining' },
      { icon: '📅', label: 'Vesting', href: '/apps/vesting' },
      { icon: '🏅', label: 'NFT Management', href: '/apps/nft' },
    ]},
    { title: 'FINANCE', items: [
      { icon: '🏦', label: 'Treasury', href: '/apps/treasury' },
      { icon: '🔗', label: 'Referral Network', href: '/apps/referral' },
      { icon: '📈', label: 'Reports', href: '/apps/reports' },
    ]},
    { title: 'CONTRACTS', items: [
      { icon: '⛓', label: 'Smart Contracts', href: '/apps/contracts' },
    ]},
  ],
};
