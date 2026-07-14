'use client'

import { Bell, Menu, Globe, Sun, Moon, LogOut } from 'lucide-react'
import { useAccount, useDisconnect, useBalance, useReadContracts } from 'wagmi'
import { useState, useCallback, useEffect } from 'react'
import { toggleTheme, getTheme } from '@/lib/theme'
import { CONTRACTS, MIC_LOCK_ABI } from '@/lib/contracts'
import { fmtCompact, DASH } from '@missionchain/sdk'
import { formatEther } from 'viem'

const erc20BalanceAbi = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }] as const

interface HeaderProps {
  onMenuClick: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const [isDark, setIsDark] = useState(true)
  const { address } = useAccount()
  const { disconnect } = useDisconnect()
  const { data: bnbBalance } = useBalance({ address })

  // Read USDT, MIC locked, MIC available
  const { data: tokenData } = useReadContracts({
    contracts: address ? [
      {
        address: CONTRACTS.usdt as `0x${string}`,
        abi: erc20BalanceAbi,
        functionName: 'balanceOf',
        args: [address],
      },
      {
        address: CONTRACTS.micToken as `0x${string}`,
        abi: MIC_LOCK_ABI,
        functionName: 'lockedBalanceOf',
        args: [address],
      },
      {
        address: CONTRACTS.micToken as `0x${string}`,
        abi: MIC_LOCK_ABI,
        functionName: 'availableBalanceOf',
        args: [address],
      },
    ] : [],
    query: { enabled: !!address },
  })

  const usdtBal = tokenData?.[0]?.result ? fmtCompact(formatEther(tokenData[0].result as bigint)) : DASH
  const micLocked = tokenData?.[1]?.result ? fmtCompact(formatEther(tokenData[1].result as bigint)) : DASH
  const micAvailable = tokenData?.[2]?.result ? fmtCompact(formatEther(tokenData[2].result as bigint)) : DASH

  useEffect(() => {
    setIsDark(getTheme() === 'dark')
  }, [])

  const handleToggle = useCallback(() => {
    const next = toggleTheme()
    setIsDark(next === 'dark')
  }, [])

  return (
    <header className="topbar">
      {/* Left: hamburger (mobile/tablet) */}
      <button
        onClick={onMenuClick}
        className="topbar-btn hide-desktop"
        aria-label="Toggle menu"
      >
        <Menu size={22} />
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Right: actions */}
      <div className="topbar-actions">
        {/* Token balances — desktop only */}
        {address && (
          <div className="topbar-balances hide-mobile">
            <div className="topbar-wallet-info">
              <div className="topbar-wallet-label">BNB</div>
              <div className="topbar-wallet-value">
                {bnbBalance && Number(bnbBalance.formatted) !== 0 ? Number(bnbBalance.formatted).toFixed(4) : DASH}
              </div>
            </div>
            <div className="topbar-wallet-info">
              <div className="topbar-wallet-label">USDT</div>
              <div className="topbar-wallet-value">{usdtBal}</div>
            </div>
            <div className="topbar-wallet-info">
              <div className="topbar-wallet-label" style={{ color: 'var(--gold)' }}>MIC</div>
              <div className="topbar-wallet-value">{micAvailable}</div>
            </div>
            <div className="topbar-wallet-info">
              <div className="topbar-wallet-label" style={{ color: 'var(--error, #e05555)' }}>Locked</div>
              <div className="topbar-wallet-value">{micLocked}</div>
            </div>
          </div>
        )}

        {/* Notifications */}
        <button className="topbar-btn" aria-label="Notifications">
          <Bell size={18} />
          <span className="topbar-badge-dot" />
        </button>

        {/* Language */}
        <button className="topbar-btn" aria-label="Language" style={{ gap: '4px' }}>
          <Globe size={16} />
          <span className="text-xs hide-mobile">EN</span>
        </button>

        {/* Theme Toggle Switch */}
        <button
          onClick={handleToggle}
          className="theme-toggle-switch"
          aria-label="Toggle theme"
          role="switch"
          aria-checked={!isDark}
        >
          <Sun size={12} className="theme-toggle-icon-sun" />
          <Moon size={12} className="theme-toggle-icon-moon" />
          <span className="theme-toggle-knob" />
        </button>

        {/* Wallet Address + Disconnect */}
        {address && (
          <div className="topbar-wallet">
            <div className="topbar-wallet-info">
              <span className="topbar-wallet-address">
                {address.slice(0, 6)}...{address.slice(-4)}
              </span>
            </div>
            <button
              onClick={() => disconnect()}
              className="topbar-btn"
              aria-label="Disconnect wallet"
              title="Disconnect"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
