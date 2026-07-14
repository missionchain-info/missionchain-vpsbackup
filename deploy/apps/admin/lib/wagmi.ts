import { createConfig, http } from 'wagmi'
import { bsc } from 'wagmi/chains'

// MAINNET-ONLY as of Phase 0 Genesis 2026-05-06
const chain = bsc

export const config = createConfig({
  chains: [chain],
  transports: {
    [bsc.id]: http('https://bsc-dataseed.binance.org/'),
  },
  ssr: false,
})
