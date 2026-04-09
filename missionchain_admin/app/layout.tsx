import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'MissionChain Admin',
  description: 'MissionChain Unified Admin Console',
  icons: {
    icon: '/images/mission-chain-logo-hd.png',
    apple: '/images/mission-chain-logo-hd.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
