'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { getFirstAccessibleModule, Role } from '@/lib/rbac';

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace('/login');
    } else {
      const module = getFirstAccessibleModule(user.role as Role);
      router.replace(`/${module}`);
    }
  }, [user, isLoading, router]);

  return null;
}
