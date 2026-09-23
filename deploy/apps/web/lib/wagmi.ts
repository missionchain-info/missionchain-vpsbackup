import { createConfig, http } from 'wagmi'
import { bsc } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

// MAINNET-ONLY as of Phase 0 Genesis 2026-05-06
// Project is permanently on BSC Mainnet (chainid 56). No testnet fallback.
const chain = bsc

const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || ''

// Initializing WalletConnect a SECOND time inside an iframe disrupts the main window's
// wallet session, because WalletConnect Core is a singleton. So when this app is framed
// we use an injected-only connector set; the MAIN window config is unchanged.
//
// The `?_vp=1` half of this check is a leftover: it was set by the device-preview overlay,
// which was removed on 2026-09-23. Nothing sets it now. The `window.self !== window.top`
// half still earns its place — it guards any embedding, not just that one.
const isPreview =
  typeof window !== 'undefined' &&
  (new URLSearchParams(window.location.search).has('_vp') || window.self !== window.top)

export const config = createConfig({
  connectors: isPreview
    ? [injected()]
    : [
        injected(),
        ...(wcProjectId
          ? [
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
            ]
          : []),
      ],
  chains: [chain],
  transports: {
    [bsc.id]: http('https://bsc-dataseed.binance.org/'),
  },
  ssr: false,
})
