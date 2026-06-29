'use client'

import { useConnect, useAccount } from 'wagmi'

export default function ConnectWallet() {
  const { connect, connectors, isPending } = useConnect()
  const { isConnected, address } = useAccount()

  const handleConnect = () => {
    // Use the injected connector — triggers native wallet popup
    const injected = connectors.find(c => c.id === 'injected') || connectors[0]
    if (injected) {
      connect({ connector: injected })
    }
  }

  if (isConnected && address) {
    return (
      <div className="w-full text-left">
        <div className="flex items-center gap-3 bg-[var(--success)]/10 border border-[var(--success)]/30 rounded-xl p-4">
          <div className="w-3 h-3 bg-[var(--success)] rounded-full animate-pulse" />
          <div>
            <div className="text-sm font-semibold text-[var(--success)] font-display">
              Wallet Connected
            </div>
            <div className="text-xs text-[var(--gray)] font-mono mt-0.5">
              {address.slice(0, 6)}...{address.slice(-4)}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full text-left">
      <h2 className="font-display font-bold text-[var(--white)] text-lg mb-2">
        Connect Your Wallet
      </h2>
      <p className="text-sm text-[var(--gray)] mb-6 font-body">
        Connect your Web3 wallet to access Mission Chain DApp. Supports MetaMask, Trust Wallet, SafePal and all EVM wallets.
      </p>

      <button
        onClick={handleConnect}
        disabled={isPending}
        className="
          w-full flex items-center gap-3
          bg-[var(--bg3)] hover:bg-[var(--bg4)]
          border border-[var(--border)] hover:border-[var(--purple)]
          rounded-xl p-4
          text-left transition-all duration-200
          disabled:opacity-50
        "
      >
        <div className="w-10 h-10 rounded-lg bg-purple/20 flex items-center justify-center flex-shrink-0">
          {isPending ? (
            <svg className="animate-spin h-5 w-5 text-purple-light" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-purple-light">
              <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
            </svg>
          )}
        </div>
        <div>
          <div className="font-display font-semibold text-sm text-[var(--white)]">
            {isPending ? 'Connecting...' : 'Connect Wallet'}
          </div>
          <div className="text-xs text-[var(--gray2)] font-body">
            MetaMask, Trust Wallet, SafePal, or any EVM wallet
          </div>
        </div>
      </button>

      <p className="text-xs text-[var(--gray2)] mt-4 font-body">
        By connecting, you agree to use BSC (BNB Smart Chain) network.
      </p>
    </div>
  )
}
