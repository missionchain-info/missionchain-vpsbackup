'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { canAccessModule, Role } from '@/lib/rbac';

interface ModuleTabsProps {
  currentModule: string;
}

const TABS = [
  { key: 'core', label: '🔗 Core-Management', accent: 'gold-accent', href: '/core' },
  { key: 'info', label: '📄 Mission Info', accent: 'teal-accent', href: '/info' },
  { key: 'world', label: '🌍 Mission World', accent: 'blue-accent', href: '/world' },
  { key: 'apps', label: '📊 Mission Apps', accent: 'purple-accent', href: '/apps' },
];

export default function ModuleTabs({ currentModule }: ModuleTabsProps) {
  const { user } = useAuth();
  const role = (user?.role || 'SUPER_ADMIN') as Role;

  return (
    <div id="module-tabs">
      {TABS.map(tab => {
        const accessible = canAccessModule(role, tab.key);
        if (!accessible) return null;
        const isActive = currentModule === tab.key;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={`module-tab ${tab.accent}${isActive ? ' active' : ''}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
