'use client'

import { useWaitForTransactionReceipt } from 'wagmi'
import { CheckCircle, XCircle, ExternalLink, RefreshCw } from 'lucide-react'
import Button from '@/components/ui/Button'

interface TransactionStatusProps {
  hash?: `0x${string}`
  onRetry?: () => void
  explorerUrl?: string
  className?: string
}

export default function TransactionStatus({
  hash,
  onRetry,
  explorerUrl = 'https://bscscan.com',
  className = '',
}: TransactionStatusProps) {
  const { isLoading, isSuccess, isError, error } = useWaitForTransactionReceipt({
    hash,
  })

  if (!hash) return null

  const txLink = `${explorerUrl}/tx/${hash}`

  return (
    <div className={className} style={{
      padding: '12px 16px',
      borderRadius: '10px',
      border: '1px solid',
      borderColor: isSuccess
        ? 'var(--success)'
        : isError
          ? 'var(--error)'
          : 'var(--border)',
      background: isSuccess
        ? 'rgba(34, 197, 94, 0.06)'
        : isError
          ? 'rgba(239, 68, 68, 0.06)'
          : 'var(--bg3)',
      marginTop: '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {isLoading && (
          <>
            <span className="spinner spinner-sm" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--white)' }}>
                Confirming...
              </div>
              <div className="font-mono" style={{ fontSize: '11px', color: 'var(--gray)', marginTop: '2px', wordBreak: 'break-all' }}>
                {hash.slice(0, 10)}...{hash.slice(-8)}
              </div>
            </div>
          </>
        )}

        {isSuccess && (
          <>
            <CheckCircle size={20} style={{ color: 'var(--success)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--success)' }}>
                Transaction Confirmed
              </div>
              <a
                href={txLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  color: 'var(--info)',
                  textDecoration: 'none',
                  marginTop: '2px',
                }}
              >
                <span className="font-mono">View on BSCScan</span>
                <ExternalLink size={10} />
              </a>
            </div>
          </>
        )}

        {isError && (
          <>
            <XCircle size={20} style={{ color: 'var(--error)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--error)' }}>
                Transaction Failed
              </div>
              <div style={{ fontSize: '11px', color: 'var(--gray)', marginTop: '2px' }}>
                {error?.message?.slice(0, 100) || 'Unknown error'}
              </div>
            </div>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw size={12} />
                <span>Retry</span>
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
