import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Mission Chain World — Where Faith Meets the Creator Economy',
  description: 'The community platform for Christian creators, builders, and entrepreneurs. SOPHIA WORD, Challenges, Content, Talent & more.',
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
      <body id="body" className="day" style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
