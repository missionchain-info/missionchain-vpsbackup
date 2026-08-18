'use client'

import { useEffect, useRef } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { bsc } from 'wagmi/chains'

/**
 * When the wallet connects on a non-BSC network, prompt a one-time switch to
 * BSC mainnet (the only chain this dApp supports). This removes the "wrong
 * network" dead-end without forcing the user to switch manually.
 *
 * - One attempt per wrong-chain value: if the user rejects the wallet prompt we
 *   do NOT spam them again for the same chain (avoids a rejection loop).
 * - Never logs the user out; switching is handled through wagmi so the session
 *   survives the chainChanged event.
 */
export default function ChainGuard() {
  const { status, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const attempted = useRef<number | null>(null)

  useEffect(() => {
    if (status !== 'connected') {
      attempted.current = null
      return
    }
    if (!chainId || chainId === bsc.id) {
      attempted.current = null
      return
    }
    if (attempted.current === chainId) return // already tried for this wrong chain
    attempted.current = chainId
    try {
      switchChain?.({ chainId: bsc.id })
    } catch {
      /* user may reject — leave the per-action "Switch to BSC" guards to handle it */
    }
  }, [status, chainId, switchChain])

  return null
}
