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
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&family=Source+Serif+4:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,700&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;700&family=Be+Vietnam+Pro:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
