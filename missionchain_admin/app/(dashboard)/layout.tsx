'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { canAccessModule, getFirstAccessibleModule, Role } from '@/lib/rbac';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import ModuleTabs from '@/components/layout/ModuleTabs';

const PAGE_TITLES: Record<string, string> = {
  '/core': 'Dashboard',
  '/core/users': 'User Management',
  '/core/kyc': 'KYC Review',
  '/core/rbac': 'Roles & Permissions',
  '/core/audit': 'Audit Log',
  '/core/system': 'Configuration',
  '/core/ai-settings': 'AI Settings',
  '/info': 'Dashboard',
  '/info/landing': 'Landing Page CMS',
  '/info/documents': 'Documents',
  '/info/translations': 'Translations',
  '/info/analytics': 'SEO & Traffic',
  '/world': 'Dashboard',
  '/world/sophia-word': 'SOPHIA WORD',
  '/world/sophia-config': 'SOPHIA Config',
  '/world/moderation': 'Moderation',
  '/world/challenges': 'Challenges',
  '/world/marketplace': 'Marketplace',
  '/apps': 'Dashboard',
  '/apps/seed': 'SEED Round',
  '/apps/presale': 'Pre-Sale',
  '/apps/mice': 'MICE License',
  '/apps/mining': 'Mining & Staking',
  '/apps/vesting': 'Vesting',
  '/apps/nft': 'NFT Management',
  '/apps/treasury': 'Treasury',
  '/apps/referral': 'Referral Network',
  '/apps/reports': 'Reports',
  '/apps/contracts': 'Smart Contracts',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  const currentModule = pathname.split('/')[1] || 'core';
  const currentPage = PAGE_TITLES[pathname] || 'Dashboard';

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    const role = user.role as Role;
    if (!canAccessModule(role, currentModule)) {
      const first = getFirstAccessibleModule(role);
      router.replace(`/${first}`);
      return;
    }
    setReady(true);
  }, [user, isLoading, router, currentModule]);

  if (isLoading || !ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: 'var(--muted)' }}>
        Loading...
      </div>
    );
  }

  return (
    <>
      <Sidebar currentModule={currentModule} />
      <Topbar currentModule={currentModule} currentPage={currentPage} />
      <ModuleTabs currentModule={currentModule} />
      <div id="main">
        <div className="page" style={{ display: 'block' }}>
          {children}
        </div>
      </div>
    </>
  );
}
