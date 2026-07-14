'use client';

import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import LoginPage from './login/page';

export default function RootPage() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/stats');
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  // Show nothing while redirecting
  return null;
}
