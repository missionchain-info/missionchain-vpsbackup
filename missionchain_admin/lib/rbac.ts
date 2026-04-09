export const ROLES = ['SUPER_ADMIN', 'FINANCE_ADMIN', 'CONTENT_ADMIN', 'MODERATOR', 'KYC_REVIEWER'] as const;
export type Role = typeof ROLES[number];

export const MODULE_ACCESS: Record<Role, Record<string, boolean>> = {
  SUPER_ADMIN:   { core: true, info: true, world: true, apps: true },
  FINANCE_ADMIN: { core: false, info: false, world: false, apps: true },
  CONTENT_ADMIN: { core: false, info: true, world: true, apps: false },
  MODERATOR:     { core: false, info: false, world: true, apps: false },
  KYC_REVIEWER:  { core: true, info: false, world: false, apps: false },
};

export const MODULE_LABELS: Record<string, string> = {
  core: 'Core-Management',
  info: 'Mission Info',
  world: 'Mission World',
  apps: 'Mission Apps',
};

export function canAccessModule(role: Role, module: string): boolean {
  return MODULE_ACCESS[role]?.[module] ?? false;
}

export function getFirstAccessibleModule(role: Role): string {
  const entry = Object.entries(MODULE_ACCESS[role] || {}).find(([, v]) => v);
  return entry ? entry[0] : 'core';
}
