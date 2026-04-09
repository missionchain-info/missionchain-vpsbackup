import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mission Chain — Inspired by Faith. Built for People.',
  description: 'The premier Web3 ecosystem built for 2.6 billion Christians worldwide. MIC Token, MICE Mining, MFP-NFT Governance, SOPHIA AI.',
  icons: {
    icon: '/images/mission-chain-logo-clear.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
