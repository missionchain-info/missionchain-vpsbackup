import { createConfig, http } from 'wagmi'
import { bsc } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

// MAINNET-ONLY as of Phase 0 Genesis 2026-05-06
// Project is permanently on BSC Mainnet (chainid 56). No testnet fallback.
const chain = bsc

const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || ''

// Only the lightweight `injected` connector is eager. WalletConnect (which pulls in
// ~950KB of @walletconnect + @reown/appkit modal code) is loaded LAZILY on demand —
// most Mission Chain users open the dApp inside a wallet's in-app browser (injected),
// so they never download the WalletConnect bundle. Keeps the initial page light.
export const config = createConfig({
  connectors: [injected()],
  chains: [chain],
  transports: {
    [bsc.id]: http('https://bsc-dataseed.binance.org/'),
  },
  ssr: false,
})

let wcPromise: Promise<any> | null = null

/**
 * Dynamically import + register the WalletConnect connector the first time a user
 * actually needs it (no injected wallet → QR / deeplink). Idempotent.
 * Returns the connector, or undefined if no WC projectId is configured.
 */
export function ensureWalletConnect(): Promise<any> {
  const existing = config.connectors.find((c) => c.id === 'walletConnect')
  if (existing) return Promise.resolve(existing)
  if (!wcProjectId) return Promise.resolve(undefined)
  if (!wcPromise) {
    wcPromise = import('wagmi/connectors').then(({ walletConnect }) => {
      const internal = (config as any)._internal.connectors
      const connector = internal.setup(
        walletConnect({
          projectId: wcProjectId,
          metadata: {
            name: 'Mission Chain',
            description: 'Faith-powered Web3 ecosystem on BNB Smart Chain',
            url: 'https://app.missionchain.io',
            icons: ['https://app.missionchain.io/icons/icon-512.png'],
          },
          showQrModal: true,
        }),
      )
      internal.setState((prev: any[]) => [...prev, connector])
      return connector
    })
  }
  return wcPromise
}
