'use client'

import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { config } from '@/lib/wagmi'
import { useEffect, useState } from 'react'
import { initTheme } from '@/lib/theme'
import ChainGuard from '@/components/wallet/ChainGuard'
import '@/styles/globals.css'

const queryClient = new QueryClient()

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    initTheme()
    setMounted(true)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
        />
        <title>Mission Chain DApp</title>
        <meta name="description" content="Mission Chain — Faith-powered Web3 ecosystem on BSC" />
        {/* PWA — installable on Android & iOS */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#140A1C" />
        <link rel="icon" href="/icons/icon-32.png" type="image/png" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-180.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Mission Chain" />
        {/* MFP-NFT card fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&family=Playfair+Display:wght@400;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400;1,600&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <ChainGuard />
            {mounted ? children : null}
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  )
}
