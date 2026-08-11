/**
 * MissionChain — Chain metadata (MAINNET ONLY)
 *
 * Mainnet-only as of May 6, 2026. Testnet support removed.
 *
 * Use `getActiveAddresses()` to access contracts (returns the bsc namespace).
 * Use `getActiveChain()` for chainId, RPC, explorer URL, native currency, etc.
 *  — anything UI / wallet-switch flows need.
 */

import { ADDRESSES, type AddressMap, type NetworkName } from './addresses'

export interface ChainInfo {
  network: NetworkName
  chainId: number
  chainIdHex: `0x${string}`
  name: string
  shortName: string
  rpcUrls: string[]
  explorerUrl: string
  usdtAddress: string
  nativeCurrency: { name: string; symbol: string; decimals: 18 }
}

const BSC_MAINNET: ChainInfo = {
  network: 'bsc',
  chainId: 56,
  chainIdHex: '0x38',
  name: 'BSC Mainnet',
  shortName: 'BSC',
  /**
   * Read endpoints for the browser, fastest first.
   *
   * Measured from the VPS: publicnode answers `eth_blockNumber` in ~0.14s against
   * ~0.31s for the Binance dataseed. The dashboard makes seven calls on load, so the
   * difference is over a second of spinner on every visit. The dataseeds stay as
   * fallbacks — publicnode is unreliable for transaction receipts, which is why the
   * server-side keepers use an archive endpoint rather than this list.
   */
  rpcUrls: [
    'https://bsc-rpc.publicnode.com',
    'https://bsc-dataseed.binance.org/',
    'https://bsc-dataseed1.binance.org/',
    'https://bsc-dataseed2.binance.org/',
  ],
  explorerUrl: 'https://bscscan.com',
  usdtAddress: '0x55d398326f99059fF775485246999027B3197955',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
}

/** Always returns 'bsc' — mainnet-only project as of 2026-05-06. */
export function getActiveNetwork(): NetworkName {
  return 'bsc'
}

/** Active address map (always bsc). */
export function getActiveAddresses(): AddressMap {
  return ADDRESSES.bsc
}

/** Active chain metadata (always BSC mainnet). */
export function getActiveChain(): ChainInfo {
  return BSC_MAINNET
}

/** Always true — mainnet-only project. */
export function isMainnet(): boolean {
  return true
}
