import { createConfig, http } from 'wagmi'
import { bsc } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

// MAINNET-ONLY as of Phase 0 Genesis 2026-05-06
// Project is permanently on BSC Mainnet (chainid 56). No testnet fallback.
const chain = bsc

const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || ''

export const config = createConfig({
  connectors: [
    injected(),
    ...(wcProjectId
      ? [
          walletConnect({
            projectId: wcProjectId,
            metadata: {
              name: 'Mission Chain DApp',
              description: 'Faith-powered Web3 ecosystem on BNB Smart Chain',
              url: 'https://missionchain.io',
              icons: ['https://missionchain.io/images/logo.png'],
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
