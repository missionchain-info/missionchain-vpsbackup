'use client';

import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/lib/wagmi';
import { AuthProvider } from '@/lib/auth';
import '@/styles/globals.css';

const queryClient = new QueryClient();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <title>Mission Chain &mdash; Admin Console</title>
        <meta name="description" content="Mission Chain Admin Console - Governing Board Only" />
        {/* Monogram MIC do. ?v= vi Cloudflare cache anh lau; them favicon.ico vi
            Chrome tu do /favicon.ico khi the tren khong dung duoc. */}
        <link rel="icon" href="/favicon.ico?v=brand20260818d" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=brand20260818d" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>{children}</AuthProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  );
}
