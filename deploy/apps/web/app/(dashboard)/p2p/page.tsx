'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import SubNav, { EXPLORE_TABS } from '@/components/layout/SubNav'
import { BrowserProvider, Contract, parseUnits } from 'ethers'
import { getActiveAddresses, getActiveChain } from '@missionchain/sdk'
import { api } from '@/lib/api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
const ACTIVE_CHAIN = getActiveChain()

/* ─── P2P Contract Constants (network-aware) ─── */
const _addr = getActiveAddresses()
const P2P_ESCROW_MFP = _addr.P2PEscrowMFP
const USDT_ADDR = _addr.MockUSDT
const MFP_ADDR = _addr.MFPNFT

const P2P_ABI = [
  'function createOrder(uint256 tokenId, uint256 priceUsdt, uint64 expirySeconds) returns (uint256)',
  'function matchOrder(uint256 id)',
  'function cancelOrder(uint256 id)',
  'function activeOrderForToken(uint256) view returns (uint256)',
  'event OrderCreated(uint256 indexed id, address indexed seller, uint256 indexed tokenId, uint256 priceUsdt, uint64 expiresAt)',
] as const

const USDT_ABI = ['function approve(address spender, uint256 amount) returns (bool)'] as const
const MFP_ABI = [
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function ownerOf(uint256) view returns (address)',
] as const

/* ─── Types ─── */
type TradeAction = 'buy' | 'sell'

type AssetType = 'MIC' | 'MFP' | 'BUILDER' | 'MAKER' | 'LUMINARY'

interface AssetConfig {
  id: AssetType
  label: string
  icon: string
  tokenStandard: string
  description: string
  color: string
}

interface AssetConfigExt extends AssetConfig {
  disabled?: boolean
}

const ASSET_CONFIGS: AssetConfigExt[] = [
  { id: 'MIC', label: 'MIC Token', icon: '\uD83D\uDCB0', tokenStandard: 'BEP-20', description: 'MissionChain Utility Token', color: 'var(--gold)', disabled: true },
  { id: 'MFP', label: 'MFP-NFT', icon: '\uD83D\uDC51', tokenStandard: 'ERC-721', description: 'Mission Founders Pass \u00D710', color: '#E040FB' },
  { id: 'BUILDER', label: 'Builder', icon: '\uD83D\uDEE0\uFE0F', tokenStandard: 'ERC-1155', description: 'Community NFT \u00D71.0', color: '#90A4AE', disabled: true },
  { id: 'MAKER', label: 'Maker', icon: '\u2B50', tokenStandard: 'ERC-1155', description: 'Community NFT \u00D72.5', color: 'var(--gold)', disabled: true },
  { id: 'LUMINARY', label: 'Luminary', icon: '\uD83D\uDC8E', tokenStandard: 'ERC-1155', description: 'Community NFT \u00D75.0', color: '#CE93D8', disabled: true },
]

// FE shape — mapped from API P2POrder (Prisma model). Phase 1: MFP-NFT only.
interface P2pOrder {
  id: string           // FE orderId (same as on-chain id)
  onChainId: number    // contract orderId
  asset: AssetType
  seller: string
  buyer: string | null
  tokenId: string      // MFP token serial (#1, #2, ...)
  priceUsdt: number    // listing price (USDT)
  royaltyUsdt: number  // 5% royalty (calc client-side)
  feeUsdt: number      // 1.5% platform fee (calc client-side)
  receivingUsdt: number // = priceUsdt - royalty - fee (seller net)
  expiresAt: string    // ISO date
  createdAt: string
  closedAt: string | null
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED' | 'EXPIRED'
  myRole?: 'seller' | 'buyer'  // set in loadOrders for My Orders combined view
  createdTxHash?: string | null
  executedTxHash?: string | null
  cancelledTxHash?: string | null
  expiredTxHash?: string | null
  // Legacy fields for backward compat with OrderCard (Phase 1 MFP-only — single unit)
  type: TradeAction
  price: number
  amount: number
  filled: number
  remaining: number
  total: number
  minOrder: number
  maxOrder: number
  legacyStatus: 'active' | 'partial' | 'filled' | 'cancelled' | 'expired'
}

const ROYALTY_BPS = 500   // 5% — read from MFPNFT in future, hardcoded Phase 1
const PLATFORM_FEE_BPS_DEFAULT = 150  // 1.5% — overridable from system-info

function mapApiOrder(apiOrder: any, platformFeeBps: number): P2pOrder {
  const priceUsdt = Number(apiOrder.priceUsdt || 0)
  const royaltyUsdt = (priceUsdt * ROYALTY_BPS) / 10000
  const feeUsdt = (priceUsdt * platformFeeBps) / 10000
  const receivingUsdt = Math.max(0, priceUsdt - royaltyUsdt - feeUsdt)
  const status = (apiOrder.status || 'PENDING') as P2pOrder['status']
  const legacyStatus: P2pOrder['legacyStatus'] =
    status === 'PENDING' ? 'active' :
    status === 'EXECUTED' ? 'filled' :
    status === 'CANCELLED' ? 'cancelled' : 'expired'
  return {
    id: apiOrder.id || String(apiOrder.onChainId),
    onChainId: Number(apiOrder.onChainId),
    asset: 'MFP',
    seller: apiOrder.seller || '',
    buyer: apiOrder.buyer || null,
    tokenId: String(apiOrder.tokenId || '0'),
    priceUsdt,
    royaltyUsdt,
    feeUsdt,
    receivingUsdt,
    expiresAt: apiOrder.expiresAt || new Date(0).toISOString(),
    createdAt: apiOrder.createdAt || new Date(0).toISOString(),
    closedAt: apiOrder.closedAt || null,
    status,
    createdTxHash: apiOrder.createdTxHash || null,
    executedTxHash: apiOrder.executedTxHash || null,
    cancelledTxHash: apiOrder.cancelledTxHash || null,
    expiredTxHash: apiOrder.expiredTxHash || null,
    // Legacy compat for OrderCard (Phase 1 MFP = always single unit)
    type: 'sell',
    price: priceUsdt,
    amount: 1,
    filled: 0,
    remaining: 1,
    total: priceUsdt,
    minOrder: 1,
    maxOrder: 1,
    legacyStatus,
  }
}

const EXPIRY_OPTIONS = [
  { value: 1, label: '1 Day' },
  { value: 3, label: '3 Days' },
  { value: 7, label: '7 Days' },
  { value: 14, label: '14 Days' },
  { value: 15, label: '15 Days' },
]

export default function P2pPage() {
  const { address: connectedAddr } = useAccount()
  const [tradeAction, setTradeAction] = useState<TradeAction>('buy')
  const [selectedAsset, setSelectedAsset] = useState<AssetType>('MFP')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedTokenId, setSelectedTokenId] = useState<string>('')
  const [p2pEnabled, setP2pEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [micPrice, setMicPrice] = useState(0.0025)
  const [platformFee, setPlatformFee] = useState(1.5) // % — fetched from admin config

  const [orders, setOrders] = useState<P2pOrder[]>([])
  const [myOrders, setMyOrders] = useState<P2pOrder[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [previewOrder, setPreviewOrder] = useState<P2pOrder | null>(null)

  // Market stats
  const [stats, setStats] = useState({ volume24h: 0, activeOrders: 0, totalTraded: 0 })

  const loadOrders = useCallback(async () => {
    const feeBps = Math.round(platformFee * 100)
    try {
      const res = await api<{ data: any[] }>('/p2p/orders')
      setOrders((res.data || []).map(o => mapApiOrder(o, feeBps)))
    } catch (e) { console.error('loadOrders:', e) }

    // My Orders = listings (as seller) + purchases (as buyer), merged + sorted
    try {
      const [sellsRes, buysRes] = await Promise.all([
        api<{ data: any[] }>('/p2p/my-orders').catch(() => ({ data: [] })),
        api<{ data: any[] }>('/p2p/history').catch(() => ({ data: [] })),
      ])
      const sells = (sellsRes.data || []).map(o => ({ ...mapApiOrder(o, feeBps), myRole: 'seller' as const }))
      const buys = (buysRes.data || []).map(o => ({ ...mapApiOrder(o, feeBps), myRole: 'buyer' as const }))
      // Dedupe by onChainId (defensive — shouldn't happen since seller != buyer per contract)
      const seen = new Set<number>()
      const merged: P2pOrder[] = []
      for (const o of [...sells, ...buys]) {
        if (seen.has(o.onChainId)) continue
        seen.add(o.onChainId)
        merged.push(o)
      }
      // Sort: PENDING active listings first, then by closedAt/createdAt DESC (newest events on top)
      merged.sort((a, b) => {
        if (a.status === 'PENDING' && b.status !== 'PENDING') return -1
        if (b.status === 'PENDING' && a.status !== 'PENDING') return 1
        const aT = a.closedAt ? new Date(a.closedAt).getTime() : new Date(a.createdAt).getTime()
        const bT = b.closedAt ? new Date(b.closedAt).getTime() : new Date(b.createdAt).getTime()
        return bT - aT
      })
      setMyOrders(merged)
    } catch (e) { console.error('loadMyOrders:', e) }
  }, [platformFee])

  useEffect(() => {
    fetch(`${API_BASE}/rounds/system-info`)
      .then(r => r.json())
      .then(data => {
        if (data?.data) {
          setP2pEnabled(data.data.p2pEnabled || false)
          setMicPrice(parseFloat(data.data.micPrice) || 0.0025)
          if (data.data.p2pFee) setPlatformFee(parseFloat(data.data.p2pFee))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    loadOrders()
  }, [loadOrders])

  // Handle URL params for deep-link from MfpActionMenu
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('action') === 'sell') {
      const tokenIdStr = params.get('tokenId')
      if (tokenIdStr) {
        setTradeAction('sell')
        setSelectedAsset('MFP')
        setSelectedTokenId(tokenIdStr)
        setShowCreateModal(true)
      }
    }
  }, [])

  const assetConfig = ASSET_CONFIGS.find(a => a.id === selectedAsset)!
  const isNFT = selectedAsset !== 'MIC'

  // Filter orders based on selection — also exclude own listings (can't buy your own MFP)
  const myAddrLower = (connectedAddr || '').toLowerCase()
  const filteredOrders = orders.filter(o => {
    if (o.asset !== selectedAsset) return false
    if (myAddrLower && o.seller.toLowerCase() === myAddrLower) return false  // hide own listings
    // When user wants to BUY, show SELL orders and vice versa
    if (tradeAction === 'buy') return o.type === 'sell'
    return o.type === 'buy'
  })

  if (!loading && !p2pEnabled) {
    return (
      <>
        <SubNav items={EXPLORE_TABS} />
        <P2pComingSoon platformFee={platformFee} />
      </>
    )
  }

  return (
    <>
      <SubNav items={EXPLORE_TABS} />
      <div className="p2p-page">

        {/* ── Hero ── */}
        <div className="p2p-hero">
          <div className="p2p-hero-bg" />
          <div className="p2p-hero-content">
            <div className="p2p-hero-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>
            </div>
            <div>
              <div className="p2p-hero-label">P2P Exchange</div>
              <div className="p2p-hero-sub">Trade MIC & NFTs directly with other members via Escrow</div>
            </div>
          </div>
        </div>

        {/* ── Asset Type Tabs ── */}
        <div className="p2p-asset-tabs">
          {ASSET_CONFIGS.map(asset => (
            <button
              key={asset.id}
              className={`p2p-asset-tab ${selectedAsset === asset.id ? 'p2p-asset-tab-active' : ''} ${asset.disabled ? 'p2p-asset-tab-disabled' : ''}`}
              onClick={() => { if (!asset.disabled) setSelectedAsset(asset.id) }}
              disabled={asset.disabled}
              style={{ '--tab-color': asset.color } as React.CSSProperties}
              title={asset.disabled ? 'Coming soon — Phase 2' : asset.label}
            >
              <span className="p2p-asset-tab-icon">{asset.icon}</span>
              <span className="p2p-asset-tab-label">{asset.label}</span>
              {asset.disabled && (
                <span className="p2p-asset-tab-soon">Soon</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Asset Info Bar ── */}
        <div className="p2p-asset-info">
          <div className="p2p-asset-info-left">
            <span className="p2p-asset-info-name" style={{ color: assetConfig.color }}>
              {assetConfig.icon} {assetConfig.label}
            </span>
            <span className="p2p-asset-info-std">{assetConfig.tokenStandard}</span>
          </div>
          <div className="p2p-asset-info-right">
            <span className="p2p-asset-info-desc">{assetConfig.description}</span>
          </div>
        </div>

        {/* ── Buy / Sell Toggle ── */}
        <div className="p2p-toggle-row">
          <button
            className={`p2p-toggle-btn ${tradeAction === 'buy' ? 'p2p-toggle-active-buy' : ''}`}
            onClick={() => setTradeAction('buy')}
          >
            {isNFT ? `Buy ${assetConfig.label}` : 'Buy MIC'}
          </button>
          <button
            className={`p2p-toggle-btn ${tradeAction === 'sell' ? 'p2p-toggle-active-sell' : ''}`}
            onClick={() => setTradeAction('sell')}
          >
            {isNFT ? `Sell ${assetConfig.label}` : 'Sell MIC'}
          </button>
        </div>

        {/* ── Market Info ── */}
        <div className="p2p-market-row">
          <div className="p2p-market-item">
            <div className="p2p-market-label">{isNFT ? 'Floor Price' : 'MIC Price'}</div>
            <div className="p2p-market-value p2p-val-gold">
              {isNFT ? '-' : (micPrice > 0 ? `$${micPrice.toFixed(4)}` : '-')}
            </div>
          </div>
          <div className="p2p-market-item">
            <div className="p2p-market-label">24h Volume</div>
            <div className="p2p-market-value">{stats.volume24h > 0 ? `$${stats.volume24h.toLocaleString()}` : '-'}</div>
          </div>
          <div className="p2p-market-item">
            <div className="p2p-market-label">Active Orders</div>
            <div className="p2p-market-value">{stats.activeOrders > 0 ? stats.activeOrders : '-'}</div>
          </div>
        </div>

        {/* ── Fee Notice ── */}
        <div className="p2p-fee-notice">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--info)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          <span>Platform fee: <strong>{platformFee}%</strong> on USDT (deducted at settlement) &bull; Fee goes to DAO Treasury</span>
        </div>

        {/* ── Order Book ── */}
        <div className="p2p-section-card">
          <div className="p2p-section-header">
            <span className="p2p-section-title">
              {tradeAction === 'buy' ? 'Available Sell Orders' : 'Available Buy Orders'}
            </span>
            <span className="p2p-section-count">{filteredOrders.length} orders</span>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="p2p-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--gray2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
              <div className="p2p-empty-text">No {tradeAction === 'buy' ? 'sell' : 'buy'} orders for {assetConfig.label}</div>
              <div className="p2p-empty-hint">Be the first to create an order!</div>
            </div>
          ) : (
            <div className="p2p-order-list">
              {filteredOrders.map(order => (
                <OrderCard key={order.id} order={order} tradeAction={tradeAction} isNFT={isNFT} assetConfig={assetConfig} setToast={setToast} loadOrders={loadOrders} onPreview={setPreviewOrder} />
              ))}
            </div>
          )}
        </div>

        {/* ── My Orders ── */}
        <div className="p2p-section-card">
          <div className="p2p-section-header">
            <span className="p2p-section-title">My Orders</span>
            <span className="p2p-section-count">
              {(() => {
                const sells = myOrders.filter(o => o.myRole === 'seller').length
                const buys = myOrders.filter(o => o.myRole === 'buyer').length
                return `${myOrders.length} total · ${sells} listing${sells === 1 ? '' : 's'} · ${buys} purchase${buys === 1 ? '' : 's'}`
              })()}
            </span>
          </div>

          {myOrders.length === 0 ? (
            <div className="p2p-empty" style={{ padding: '20px 0' }}>
              <div className="p2p-empty-text">No orders yet</div>
              <div className="p2p-empty-hint">Listings you create or NFTs you buy will appear here</div>
            </div>
          ) : (
            <div className="p2p-order-list">
              {myOrders.map(order => (
                <MyOrderCard key={order.id} order={order} assetConfig={assetConfig} setToast={setToast} loadOrders={loadOrders} onPreview={setPreviewOrder} />
              ))}
            </div>
          )}
        </div>

        {/* ── Create Order CTA ── */}
        <div className="p2p-create-row">
          <button className="p2p-create-btn" onClick={() => setShowCreateModal(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Create {tradeAction === 'buy' ? 'Buy' : 'Sell'} Order
          </button>
          <div className="p2p-create-hint">
            {tradeAction === 'sell'
              ? `Your ${assetConfig.label} will be locked in Escrow until the order is filled or cancelled`
              : 'Your USDT will be locked in Escrow until a seller matches your order'}
          </div>
        </div>

        {/* ── How It Works ── */}
        <HowItWorks isNFT={isNFT} assetLabel={assetConfig.label} platformFee={platformFee} />
      </div>

      {/* ── Create Order Modal ── */}
      {showCreateModal && (
        <CreateOrderModal
          tradeAction={tradeAction}
          asset={selectedAsset}
          assetConfig={assetConfig}
          isNFT={isNFT}
          micPrice={micPrice}
          platformFee={platformFee}
          prefilledTokenId={selectedTokenId}
          onClose={() => { setShowCreateModal(false); setSelectedTokenId('') }}
          onSubmit={async (order) => {
            try {
              const ethereum = (window as any).ethereum
              if (!ethereum) throw new Error('No wallet detected. Please install MetaMask.')
              let provider = new BrowserProvider(ethereum)

              // Network check + auto-switch to BSC Mainnet (chainId 56)
              let network = await provider.getNetwork()
              if (Number(network.chainId) !== ACTIVE_CHAIN.chainId) {
                setToast(`Switching to ${ACTIVE_CHAIN.name}...`)
                try {
                  await ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: ACTIVE_CHAIN.chainIdHex }],
                  })
                } catch (switchErr: any) {
                  if (switchErr?.code === 4902) {
                    try {
                      await ethereum.request({
                        method: 'wallet_addEthereumChain',
                        params: [{
                          chainId: ACTIVE_CHAIN.chainIdHex,
                          chainName: ACTIVE_CHAIN.name,
                          nativeCurrency: ACTIVE_CHAIN.nativeCurrency,
                          rpcUrls: ACTIVE_CHAIN.rpcUrls,
                          blockExplorerUrls: [ACTIVE_CHAIN.explorerUrl],
                        }],
                      })
                    } catch {
                      setToast(`Failed to add ${ACTIVE_CHAIN.name} — please add manually`)
                      setTimeout(() => setToast(null), 6000)
                      return
                    }
                  } else {
                    setToast(`Wrong network — please switch to ${ACTIVE_CHAIN.name} manually`)
                    setTimeout(() => setToast(null), 6000)
                    return
                  }
                }
                provider = new BrowserProvider(ethereum)
                network = await provider.getNetwork()
                if (Number(network.chainId) !== ACTIVE_CHAIN.chainId) {
                  setToast('Network switch failed — still on chainId ' + network.chainId)
                  setTimeout(() => setToast(null), 6000)
                  return
                }
              }

              const signer = await provider.getSigner()
              const mfp = new Contract(MFP_ADDR, MFP_ABI, signer)
              const p2p = new Contract(P2P_ESCROW_MFP, P2P_ABI, signer)

              const sellerAddr = await signer.getAddress()

              // B8: on-chain ownership check — catches staked / transferred MFP / non-existent token
              if (order.asset === 'MFP' && order.tokenId) {
                setToast('Checking on-chain ownership...')
                let onChainOwner: string
                try {
                  onChainOwner = await mfp.ownerOf(BigInt(order.tokenId))
                } catch (ownErr: any) {
                  setToast(`MFP #${order.tokenId} does not exist or contract unreachable. Check token ID.`)
                  setTimeout(() => setToast(null), 6000)
                  return
                }
                if (onChainOwner.toLowerCase() !== sellerAddr.toLowerCase()) {
                  setToast(`MFP #${order.tokenId} is owned by ${onChainOwner.slice(0, 8)}…${onChainOwner.slice(-4)} (not you). Cannot list.`)
                  setTimeout(() => setToast(null), 6000)
                  return
                }
              }

              const isAllApproved = await mfp.isApprovedForAll(sellerAddr, P2P_ESCROW_MFP)
              if (!isAllApproved) {
                setToast('Sign approval for MFP-NFT...')
                const approveTx = await mfp.setApprovalForAll(P2P_ESCROW_MFP, true)
                await approveTx.wait()
              }

              setToast('Sign createOrder tx...')
              const priceWei = parseUnits(order.price.toString(), 6)
              const expirySec = BigInt(order.expiryDays * 86400)
              const tokenId = BigInt(order.tokenId || '0')
              const tx = await p2p.createOrder(tokenId, priceWei, expirySec)
              setToast(`Confirming on-chain... ${tx.hash.slice(0, 10)}...`)
              await tx.wait()
              setToast('Order created ✓ — eventSync will index in 30s')
              setTimeout(() => setToast(null), 5000)
              setShowCreateModal(false)
              setTimeout(loadOrders, 2000)
            } catch (err: any) {
              setToast('Error: ' + (err?.reason || err?.message || 'Unknown error'))
              setTimeout(() => setToast(null), 6000)
            }
          }}
        />
      )}

      {/* Order Preview Modal — image top + info bottom, click order card to open */}
      <OrderPreviewModal
        order={previewOrder}
        myAddrLower={myAddrLower}
        platformFee={platformFee}
        onClose={() => setPreviewOrder(null)}
        setToast={setToast}
        loadOrders={loadOrders}
      />

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: 'var(--card)', border: '1px solid var(--gold)',
          padding: '12px 18px', borderRadius: 8,
          fontSize: '0.7rem', color: 'var(--white)', maxWidth: 400, zIndex: 9999,
        }}>
          {toast}
        </div>
      )}
    </>
  )
}


/* ═══════════════════════════════════════════
   ORDER CARD (in order book)
   ═══════════════════════════════════════════ */
function OrderCard({ order, tradeAction, isNFT, assetConfig, setToast, loadOrders, onPreview }: {
  order: P2pOrder; tradeAction: TradeAction; isNFT: boolean; assetConfig: AssetConfig
  setToast: (msg: string | null) => void
  loadOrders: () => void
  onPreview: (order: P2pOrder) => void
}) {
  const [fillAmount, setFillAmount] = useState('')
  const [showFill, setShowFill] = useState(false)

  const progress = order.amount > 0 ? ((order.filled / order.amount) * 100) : 0
  const timeLeft = getTimeLeft(order.expiresAt)

  return (
    <div
      className="p2p-order-card"
      onClick={() => isNFT && onPreview(order)}
      style={isNFT ? { cursor: 'pointer' } : undefined}
    >
      <div className="p2p-order-top">
        <span className="p2p-order-seller">
          {order.seller.slice(0, 6)}...{order.seller.slice(-4)}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {order.legacyStatus === 'partial' && (
            <span className="p2p-order-partial">Partial</span>
          )}
          <span className="p2p-order-expiry">{timeLeft}</span>
        </div>
      </div>

      <div className="p2p-order-info">
        <div className="p2p-order-col">
          <div className="p2p-order-label">Price</div>
          <div className="p2p-order-val p2p-val-gold">
            ${order.price.toLocaleString('en-US', { minimumFractionDigits: isNFT ? 2 : 4 })}
            <span style={{ fontSize: '0.45rem', color: 'var(--gray2)', marginLeft: 2 }}>
              /{isNFT ? 'NFT' : 'MIC'}
            </span>
          </div>
        </div>
        <div className="p2p-order-col">
          <div className="p2p-order-label">{isNFT ? 'Quantity' : 'Amount'}</div>
          <div className="p2p-order-val">
            {isNFT
              ? `${order.remaining} NFT`
              : `${order.remaining.toLocaleString()} MIC`}
          </div>
        </div>
        <div className="p2p-order-col">
          <div className="p2p-order-label">Total</div>
          <div className="p2p-order-val">${(order.remaining * order.price).toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
        </div>
      </div>

      {/* Progress bar for partial fills */}
      {order.filled > 0 && (
        <div className="p2p-order-progress">
          <div className="p2p-order-progress-bar" style={{ width: `${progress}%` }} />
          <span className="p2p-order-progress-text">{progress.toFixed(0)}% filled</span>
        </div>
      )}

      <div className="p2p-order-bottom">
        <div className="p2p-order-limit">
          {isNFT
            ? `Min: ${order.minOrder} \u2022 Max: ${order.maxOrder} NFT`
            : `$${order.minOrder.toLocaleString()} \u2013 $${order.maxOrder.toLocaleString()}`}
        </div>

        {!showFill ? (
          <button
            className={`p2p-order-btn ${tradeAction === 'buy' ? 'p2p-btn-buy' : 'p2p-btn-sell'}`}
            onClick={(e) => { e.stopPropagation(); setShowFill(true) }}
          >
            {tradeAction === 'buy' ? 'Buy' : 'Sell'}
          </button>
        ) : (
          <div className="p2p-fill-row" onClick={(e) => e.stopPropagation()}>
            {!isNFT && (
              <input
                type="number"
                className="p2p-fill-input"
                placeholder="USDT amount"
                value={fillAmount}
                onChange={e => setFillAmount(e.target.value)}
              />
            )}
            <button
              className={`p2p-order-btn ${tradeAction === 'buy' ? 'p2p-btn-buy' : 'p2p-btn-sell'}`}
              onClick={async () => {
                try {
                  const ethereum = (window as any).ethereum
                  if (!ethereum) throw new Error('No wallet detected. Please install MetaMask.')
                  const provider = new BrowserProvider(ethereum)
                  const signer = await provider.getSigner()
                  const usdt = new Contract(USDT_ADDR, USDT_ABI, signer)
                  const p2p = new Contract(P2P_ESCROW_MFP, P2P_ABI, signer)

                  // Network check: ensure wallet on BSC mainnet (chainId 56). Auto-prompt switch if not.
                  let network = await provider.getNetwork()
                  if (Number(network.chainId) !== ACTIVE_CHAIN.chainId) {
                    setToast(`Switching to ${ACTIVE_CHAIN.name}...`)
                    try {
                      await (window as any).ethereum.request({
                        method: 'wallet_switchEthereumChain',
                        params: [{ chainId: ACTIVE_CHAIN.chainIdHex }],  // 56 hex (ACTIVE_CHAIN.chainIdHex = 0x38 mainnet)
                      })
                    } catch (switchErr: any) {
                      // If chain not added (4902), add it
                      if (switchErr?.code === 4902) {
                        try {
                          await (window as any).ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [{
                              chainId: ACTIVE_CHAIN.chainIdHex,
                              chainName: ACTIVE_CHAIN.name,
                              nativeCurrency: ACTIVE_CHAIN.nativeCurrency,
                              rpcUrls: ACTIVE_CHAIN.rpcUrls,
                              blockExplorerUrls: [ACTIVE_CHAIN.explorerUrl],
                            }],
                          })
                        } catch {
                          setToast(`Failed to add ${ACTIVE_CHAIN.name} to wallet — please add manually`)
                          setTimeout(() => setToast(null), 6000)
                          return
                        }
                      } else {
                        setToast(`Wrong network — please switch to ${ACTIVE_CHAIN.name} manually`)
                        setTimeout(() => setToast(null), 6000)
                        return
                      }
                    }
                    // Re-fetch provider after switch (chain changed event)
                    const newProvider = new BrowserProvider((window as any).ethereum)
                    network = await newProvider.getNetwork()
                    if (Number(network.chainId) !== ACTIVE_CHAIN.chainId) {
                      setToast('Network switch failed — still on chainId ' + network.chainId)
                      setTimeout(() => setToast(null), 6000)
                      return
                    }
                  }

                  // B11: on-chain freshness check — best-effort, contract revert is the hard gate
                  if (order.tokenId) {
                    try {
                      const activeId: bigint = await p2p.activeOrderForToken(BigInt(order.tokenId))
                      if (Number(activeId) !== Number(order.onChainId)) {
                        setToast('Order no longer available — refreshing...')
                        setTimeout(() => setToast(null), 4000)
                        loadOrders()
                        return
                      }
                    } catch (freshErr) {
                      console.warn('[P2P] freshness check skipped:', freshErr)
                      // Continue to matchOrder — contract will revert with proper error if order invalid
                    }
                  }

                  const priceWei = parseUnits(order.price.toString(), 6)
                  setToast('Sign USDT approval...')
                  const approveTx = await usdt.approve(P2P_ESCROW_MFP, priceWei)
                  await approveTx.wait()

                  setToast('Sign matchOrder tx...')
                  const tx = await p2p.matchOrder(BigInt(order.onChainId))
                  setToast(`Confirming on-chain... ${tx.hash.slice(0, 10)}...`)
                  await tx.wait()
                  setToast('Order matched ✓')
                  setTimeout(() => setToast(null), 5000)
                  setShowFill(false)
                  setFillAmount('')
                  setTimeout(loadOrders, 2000)
                } catch (err: any) {
                  setToast('Error: ' + (err?.reason || err?.message || 'Unknown error'))
                  setTimeout(() => setToast(null), 6000)
                }
              }}
            >
              Confirm
            </button>
            <button className="p2p-fill-cancel" onClick={() => { setShowFill(false); setFillAmount('') }}>
              {'\u2715'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════
   MY ORDER CARD — Phase 1 MFP-only spec per anh
   Columns: Created (Date+Time) / Name / Serie / Offer Price / Royalty+Fee /
            Receiving (=Price-Royalty-Fee) / Time Left / Status / Cancel
   ═══════════════════════════════════════════ */
function MyOrderCard({ order, assetConfig, setToast, loadOrders, onPreview }: {
  order: P2pOrder; assetConfig: AssetConfig
  setToast: (msg: string | null) => void
  loadOrders: () => void
  onPreview: (order: P2pOrder) => void
}) {
  const createdDate = new Date(order.createdAt)
  const dateStr = createdDate.toLocaleDateString('en-GB')      // DD/MM/YYYY
  const timeStr = createdDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const expiresDate = new Date(order.expiresAt)
  const hoursLeft = Math.max(0, Math.floor((expiresDate.getTime() - Date.now()) / 3_600_000))

  // Status mapping per anh's spec, with role-aware label for buyer view:
  //   seller + PENDING   → "Pending"   (active listing)
  //   seller + EXECUTED  → "Sold"      (matched, NFT to buyer)
  //   buyer  + EXECUTED  → "Bought"    (purchase confirmed on-chain)
  //   seller + CANCELLED → "Cancelled" (seller cancelled)
  //   seller + EXPIRED   → "Unsold"    (timed out, NFT auto-released by backend cron)
  const isBuyer = order.myRole === 'buyer'
  const statusLabel = order.status === 'PENDING'   ? 'Pending'
                    : order.status === 'EXECUTED'  ? (isBuyer ? 'Bought' : 'Sold')
                    : order.status === 'CANCELLED' ? 'Cancelled'
                    : 'Unsold'
  const statusColor = order.status === 'PENDING'   ? 'var(--gold)'
                    : order.status === 'EXECUTED'  ? '#4CAF50'
                    : order.status === 'CANCELLED' ? '#EF5350'
                    : 'var(--gray2)'

  const fmtUsd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Pick the most relevant tx for this row: closing tx if any, else creation tx.
  const closingTx = order.executedTxHash || order.cancelledTxHash || order.expiredTxHash
  const txHash = closingTx || order.createdTxHash || null
  const txLabel = order.executedTxHash ? (isBuyer ? 'Buy' : 'Sale')
                : order.cancelledTxHash ? 'Cancel'
                : order.expiredTxHash ? 'Expire'
                : 'Create'

  return (
    <div
      className="p2p-order-card p2p-my-order"
      onClick={() => onPreview(order)}
      style={{ cursor: 'pointer' }}
    >
      <div className="p2p-order-top">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="p2p-order-seller" style={{ color: assetConfig.color }}>
            {assetConfig.icon} Mission Founders Pass <strong>#{order.tokenId}</strong>
          </span>
          <span style={{
            fontSize: '0.55rem', padding: '2px 8px', borderRadius: 4,
            background: isBuyer ? 'rgba(76,175,80,.15)' : 'rgba(212,175,55,.15)',
            color: isBuyer ? '#4CAF50' : 'var(--gold)',
            border: `1px solid ${isBuyer ? '#4CAF50' : 'var(--gold)'}`,
            fontWeight: 700, letterSpacing: 0.5,
          }}>
            {isBuyer ? 'BOUGHT' : 'LISTING'}
          </span>
        </div>
        <span className="p2p-order-status-badge" style={{ color: statusColor, borderColor: statusColor }}>
          {statusLabel}
        </span>
      </div>

      <div className="p2p-order-info" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginTop: 8 }}>
        <div className="p2p-order-col">
          <div className="p2p-order-label">Created</div>
          <div className="p2p-order-val" style={{ fontSize: '0.7rem' }}>{dateStr}</div>
          <div className="p2p-order-val" style={{ fontSize: '0.6rem', color: 'var(--gray2)' }}>{timeStr}</div>
        </div>
        <div className="p2p-order-col">
          <div className="p2p-order-label">Offer Price</div>
          <div className="p2p-order-val p2p-val-gold">{fmtUsd(order.priceUsdt)}</div>
        </div>
        <div className="p2p-order-col">
          <div className="p2p-order-label">Royalty (5%) + Fee (1.5%)</div>
          <div className="p2p-order-val" style={{ color: 'var(--crimson2)' }}>
            -{fmtUsd(order.royaltyUsdt + order.feeUsdt)}
          </div>
          <div style={{ fontSize: '0.5rem', color: 'var(--gray2)' }}>
            R: {fmtUsd(order.royaltyUsdt)} · F: {fmtUsd(order.feeUsdt)}
          </div>
        </div>
        <div className="p2p-order-col">
          <div className="p2p-order-label">{isBuyer ? 'Paid' : 'Receiving'}</div>
          <div className="p2p-order-val" style={{ color: isBuyer ? 'var(--crimson2)' : '#4CAF50', fontWeight: 700 }}>
            {fmtUsd(isBuyer ? order.priceUsdt : order.receivingUsdt)}
          </div>
        </div>
        <div className="p2p-order-col">
          <div className="p2p-order-label">TX ({txLabel})</div>
          {txHash ? (
            <a
              href={`https://bscscan.com/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p2p-order-val"
              style={{ fontSize: '0.6rem', color: 'var(--gold)', textDecoration: 'underline', wordBreak: 'break-all' }}
              title={txHash}
            >
              {txHash.slice(0, 6)}…{txHash.slice(-4)} ↗
            </a>
          ) : (
            <div className="p2p-order-val" style={{ fontSize: '0.6rem', color: 'var(--gray2)' }}>—</div>
          )}
        </div>
      </div>

      <div className="p2p-order-bottom" style={{ marginTop: 12 }}>
        <span className="p2p-order-expiry">
          {order.status === 'PENDING'
            ? `Time left: ${hoursLeft}h`
            : order.closedAt
              ? `${isBuyer && order.status === 'EXECUTED' ? 'Bought' : 'Closed'}: ${new Date(order.closedAt).toLocaleDateString('en-GB')} ${new Date(order.closedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
              : ''}
        </span>
        {order.status === 'PENDING' ? (
          <button
            className="p2p-order-btn p2p-btn-cancel"
            onClick={async (e) => {
              e.stopPropagation()
              try {
                const ethereum = (window as any).ethereum
                if (!ethereum) throw new Error('No wallet detected. Please install MetaMask.')
                const provider = new BrowserProvider(ethereum)
                const signer = await provider.getSigner()
                const usdt = new Contract(USDT_ADDR, USDT_ABI, signer)
                const p2p = new Contract(P2P_ESCROW_MFP, P2P_ABI, signer)

                setToast('Sign $10 USDT approval (cancellation fee)...')
                const approveTx = await usdt.approve(P2P_ESCROW_MFP, 10_000_000n)
                await approveTx.wait()

                setToast('Sign cancelOrder tx...')
                const tx = await p2p.cancelOrder(BigInt(order.onChainId))
                setToast(`Confirming on-chain... ${tx.hash.slice(0, 10)}...`)
                await tx.wait()
                setToast('Order cancelled ✓ — NFT returned (charged $10 fee)')
                setTimeout(() => setToast(null), 5000)
                setTimeout(loadOrders, 2000)
              } catch (err: any) {
                setToast('Error: ' + (err?.reason || err?.message || 'Unknown error'))
                setTimeout(() => setToast(null), 6000)
              }
            }}
          >
            Cancel ($10 fee)
          </button>
        ) : null}
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════
   CREATE ORDER MODAL
   ═══════════════════════════════════════════ */
function CreateOrderModal({ tradeAction, asset, assetConfig, isNFT, micPrice, platformFee, prefilledTokenId = '', onClose, onSubmit }: {
  tradeAction: TradeAction
  asset: AssetType
  assetConfig: AssetConfig
  isNFT: boolean
  micPrice: number
  platformFee: number
  prefilledTokenId?: string
  onClose: () => void
  onSubmit: (data: any) => void
}) {
  const [price, setPrice] = useState(isNFT ? '' : micPrice.toString())
  const [amount, setAmount] = useState(asset === 'MFP' ? '1' : '')
  const [minOrder, setMinOrder] = useState(isNFT ? '1' : '10')
  const [maxOrder, setMaxOrder] = useState('')
  const [expiryDays, setExpiryDays] = useState(7)
  const [tokenId, setTokenId] = useState(prefilledTokenId) // for MFP ERC-721
  const [submitting, setSubmitting] = useState(false)

  const priceNum = parseFloat(price) || 0
  const amountNum = parseFloat(amount) || 0
  const totalUsdt = priceNum * amountNum
  const royaltyAmount = isNFT ? (totalUsdt * ROYALTY_BPS) / 10000 : 0
  const feeAmount = totalUsdt * (platformFee / 100)
  const sellerReceives = totalUsdt - royaltyAmount - feeAmount

  const isSell = tradeAction === 'sell'

  const handleSubmit = () => {
    if (!priceNum || !amountNum) return
    setSubmitting(true)

    const orderData = {
      type: tradeAction,
      asset,
      price: priceNum,
      amount: amountNum,
      minOrder: parseFloat(minOrder) || (isNFT ? 1 : 10),
      maxOrder: parseFloat(maxOrder) || totalUsdt,
      expiryDays,
      tokenId: asset === 'MFP' ? tokenId : undefined,
    }

    onSubmit(orderData)
    setSubmitting(false)
  }

  return (
    <div className="p2p-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="p2p-modal">
        <div className="p2p-modal-header">
          <div>
            <div className="p2p-modal-title">
              Create {tradeAction === 'buy' ? 'Buy' : 'Sell'} Order
            </div>
            <div className="p2p-modal-subtitle">
              {assetConfig.icon} {assetConfig.label} &bull; {assetConfig.tokenStandard}
            </div>
          </div>
          <button className="p2p-modal-close" onClick={onClose}>{'\u2715'}</button>
        </div>

        <div className="p2p-modal-body">

          {/* Escrow notice */}
          <div className="p2p-modal-notice">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span>
              {isSell
                ? `Your ${assetConfig.label} will be deposited into the Escrow contract and locked until the order is filled or you cancel it.`
                : `Your USDT will be deposited into the Escrow contract. When a seller matches, ${assetConfig.label} is sent to your wallet automatically.`}
            </span>
          </div>

          {/* MFP Token ID (ERC-721 only) */}
          {asset === 'MFP' && isSell && (
            <div className="p2p-modal-field">
              <label className="p2p-modal-label">MFP Token ID</label>
              <input
                type="text"
                className="p2p-modal-input"
                placeholder="Enter your MFP-NFT Token ID"
                value={tokenId}
                onChange={e => setTokenId(e.target.value)}
              />
              <div className="p2p-modal-hint">The specific MFP-NFT you want to sell (ERC-721 unique ID)</div>
            </div>
          )}

          {/* Price per unit */}
          <div className="p2p-modal-field">
            <label className="p2p-modal-label">
              Price per {isNFT ? 'NFT' : 'MIC'} (USDT)
            </label>
            <div className="p2p-modal-input-wrap">
              <input
                type="number"
                className="p2p-modal-input"
                placeholder="0.00"
                value={price}
                onChange={e => setPrice(e.target.value)}
                step={isNFT ? '1' : '0.0001'}
              />
              <span className="p2p-modal-input-suffix">USDT</span>
            </div>
            {!isNFT && micPrice > 0 && (
              <div className="p2p-modal-hint">
                Pool price: ${micPrice.toFixed(4)} &bull;
                {priceNum > 0 && (
                  <span style={{ color: priceNum > micPrice ? 'var(--success)' : priceNum < micPrice ? 'var(--error)' : 'var(--gray2)' }}>
                    {' '}{priceNum > micPrice ? '+' : ''}{((priceNum - micPrice) / micPrice * 100).toFixed(1)}% vs pool
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Amount / Quantity — hidden for MFP (ERC-721 = always 1 unique token per listing) */}
          {asset !== 'MFP' && (
            <div className="p2p-modal-field">
              <label className="p2p-modal-label">
                {isNFT ? 'Quantity' : 'Amount (MIC)'}
              </label>
              <div className="p2p-modal-input-wrap">
                <input
                  type="number"
                  className="p2p-modal-input"
                  placeholder={isNFT ? '1' : '0'}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  step={isNFT ? '1' : '1000'}
                  min={isNFT ? '1' : '1'}
                />
                <span className="p2p-modal-input-suffix">{isNFT ? 'NFT' : 'MIC'}</span>
              </div>
            </div>
          )}

          {/* Min/Max Order — hidden for MFP (single unique token, not divisible) */}
          {asset !== 'MFP' && (
            <div className="p2p-modal-field-row">
              <div className="p2p-modal-field">
                <label className="p2p-modal-label">Min Order</label>
                <div className="p2p-modal-input-wrap">
                  <input
                    type="number"
                    className="p2p-modal-input"
                    value={minOrder}
                    onChange={e => setMinOrder(e.target.value)}
                    placeholder={isNFT ? '1' : '10'}
                  />
                  <span className="p2p-modal-input-suffix">{isNFT ? 'NFT' : 'USDT'}</span>
                </div>
              </div>
              <div className="p2p-modal-field">
                <label className="p2p-modal-label">Max Order</label>
                <div className="p2p-modal-input-wrap">
                  <input
                    type="number"
                    className="p2p-modal-input"
                    value={maxOrder}
                    onChange={e => setMaxOrder(e.target.value)}
                    placeholder={isNFT ? String(amountNum || '') : String(totalUsdt > 0 ? totalUsdt.toFixed(0) : '')}
                  />
                  <span className="p2p-modal-input-suffix">{isNFT ? 'NFT' : 'USDT'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Expiry */}
          <div className="p2p-modal-field">
            <label className="p2p-modal-label">Order Expiry</label>
            <div className="p2p-expiry-row">
              {EXPIRY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`p2p-expiry-btn ${expiryDays === opt.value ? 'p2p-expiry-active' : ''}`}
                  onClick={() => setExpiryDays(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          {priceNum > 0 && amountNum > 0 && (
            <div className="p2p-modal-summary">
              <div className="p2p-summary-row">
                <span>Total Value</span>
                <span className="p2p-summary-val">${totalUsdt.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</span>
              </div>
              {isNFT && (
                <div className="p2p-summary-row">
                  <span>Royalty (5%)</span>
                  <span className="p2p-summary-val" style={{ color: 'var(--warning)' }}>-${royaltyAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                </div>
              )}
              <div className="p2p-summary-row">
                <span>Platform Fee ({platformFee}%)</span>
                <span className="p2p-summary-val" style={{ color: 'var(--warning)' }}>-${feeAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="p2p-summary-divider" />
              <div className="p2p-summary-row p2p-summary-total">
                <span>{isSell ? 'Seller Receives' : 'Buyer Pays'}</span>
                <span className="p2p-summary-val" style={{ color: 'var(--gold)', fontSize: '0.78rem' }}>
                  {isSell
                    ? `$${sellerReceives.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT`
                    : `$${totalUsdt.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT`}
                </span>
              </div>
              {isSell && (
                <div className="p2p-summary-row">
                  <span>You Deposit into Escrow</span>
                  <span className="p2p-summary-val">
                    {isNFT ? `${amountNum} ${assetConfig.label}` : `${amountNum.toLocaleString()} MIC`}
                  </span>
                </div>
              )}
              {!isSell && (
                <div className="p2p-summary-row">
                  <span>You Deposit into Escrow</span>
                  <span className="p2p-summary-val">${totalUsdt.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p2p-modal-footer">
          <button className="p2p-modal-btn-cancel" onClick={onClose}>Cancel</button>
          <button
            className={`p2p-modal-btn-submit ${isSell ? 'p2p-modal-btn-sell' : 'p2p-modal-btn-buy'}`}
            disabled={!priceNum || !amountNum || submitting || (asset === 'MFP' && isSell && !tokenId)}
            onClick={handleSubmit}
          >
            {submitting ? 'Processing...' : `${isSell ? 'Deposit & List' : 'Deposit & Create'} Order`}
          </button>
        </div>
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════
   HOW IT WORKS
   ═══════════════════════════════════════════ */
function HowItWorks({ isNFT, assetLabel, platformFee }: { isNFT: boolean; assetLabel: string; platformFee: number }) {
  const steps = isNFT ? [
    { icon: '\uD83D\uDCDD', title: 'Create Order', desc: `List your ${assetLabel} for sale with price in USDT, or create a buy order.` },
    { icon: '\uD83D\uDD12', title: 'Escrow Lock', desc: `Seller's NFT (or Buyer's USDT) is locked in the smart contract escrow.` },
    { icon: '\uD83E\uDD1D', title: 'Match & Fill', desc: 'Counter-party matches the order. Partial fills supported.' },
    { icon: '\u26A1', title: 'Atomic Settlement', desc: `NFT \u2192 Buyer, USDT (minus ${platformFee}% fee) \u2192 Seller. All in one transaction.` },
  ] : [
    { icon: '\uD83D\uDCDD', title: 'Create Order', desc: 'Set your price, amount, and expiry (1\u201315 days).' },
    { icon: '\uD83D\uDD12', title: 'Escrow Lock', desc: 'Seller deposits MIC / Buyer deposits USDT into escrow contract.' },
    { icon: '\uD83E\uDD1D', title: 'Match & Partial Fill', desc: 'Other members can fill your order partially or fully.' },
    { icon: '\u26A1', title: 'Atomic Settlement', desc: `MIC \u2192 Buyer, USDT (minus ${platformFee}% fee) \u2192 Seller. Instant & trustless.` },
  ]

  return (
    <div className="p2p-section-card" style={{ marginBottom: 24 }}>
      <div className="p2p-section-header">
        <span className="p2p-section-title">How P2P Escrow Works</span>
      </div>
      <div className="p2p-steps">
        {steps.map((step, i) => (
          <div key={i} className="p2p-step">
            <div className="p2p-step-num">{i + 1}</div>
            <div className="p2p-step-icon">{step.icon}</div>
            <div className="p2p-step-title">{step.title}</div>
            <div className="p2p-step-desc">{step.desc}</div>
          </div>
        ))}
      </div>
      <div className="p2p-escrow-note">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span>All trades are settled on-chain via <strong>P2PEscrow.sol</strong> smart contract. No counterparty risk.</span>
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════
   COMING SOON (when p2p disabled)
   ═══════════════════════════════════════════ */
function P2pComingSoon({ platformFee }: { platformFee: number }) {
  return (
    <div className="p2p-page">
      <div className="p2p-coming-soon">
        <div className="p2p-cs-bg" />
        <div className="p2p-cs-content">
          <div className="p2p-cs-icon-wrap">
            <div className="p2p-cs-ring" />
            <div className="p2p-cs-ring p2p-cs-ring-2" />
            <div className="p2p-cs-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>
            </div>
          </div>

          <div className="p2p-cs-title">P2P Exchange Coming Soon</div>
          <div className="p2p-cs-sub">Trade MIC & NFTs directly with other members</div>

          <div className="p2p-cs-features">
            <div className="p2p-cs-feature">
              <span className="p2p-cs-feature-icon">{'\uD83D\uDCB0'}</span>
              <span>MIC Token Trading</span>
            </div>
            <div className="p2p-cs-feature">
              <span className="p2p-cs-feature-icon">{'\uD83D\uDC51'}</span>
              <span>MFP-NFT Marketplace</span>
            </div>
            <div className="p2p-cs-feature">
              <span className="p2p-cs-feature-icon">{'\uD83D\uDEE0\uFE0F'}</span>
              <span>Community NFT Trading</span>
            </div>
            <div className="p2p-cs-feature">
              <span className="p2p-cs-feature-icon">{'\uD83D\uDD12'}</span>
              <span>On-chain Escrow</span>
            </div>
            <div className="p2p-cs-feature">
              <span className="p2p-cs-feature-icon">{'\u26A1'}</span>
              <span>Atomic Settlement</span>
            </div>
            <div className="p2p-cs-feature">
              <span className="p2p-cs-feature-icon">{'\uD83D\uDCC8'}</span>
              <span>Partial Fill Support</span>
            </div>
          </div>

          <div className="p2p-cs-info">
            <div className="p2p-cs-info-item">
              <span className="p2p-cs-info-label">Platform Fee</span>
              <span className="p2p-cs-info-value">{platformFee}%</span>
            </div>
            <div className="p2p-cs-info-item">
              <span className="p2p-cs-info-label">Fee Destination</span>
              <span className="p2p-cs-info-value">DAO Treasury</span>
            </div>
            <div className="p2p-cs-info-item">
              <span className="p2p-cs-info-label">Settlement</span>
              <span className="p2p-cs-info-value">On-chain Escrow</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */
function getTimeLeft(expiresAt: string): string {
  const now = Date.now()
  const exp = new Date(expiresAt).getTime()
  const diff = exp - now
  if (diff <= 0) return 'Expired'
  const days = Math.floor(diff / 86400000)
  const hours = Math.floor((diff % 86400000) / 3600000)
  if (days > 0) return `${days}d ${hours}h left`
  const mins = Math.floor((diff % 3600000) / 60000)
  return `${hours}h ${mins}m left`
}


/* ═══════════════════════════════════════════
   ORDER PREVIEW MODAL — image top + info bottom (mobile-friendly)
   Click any order card (own or others) → preview MFP image + verse + pricing.
   Buy button visible only for non-self PENDING orders.
   ═══════════════════════════════════════════ */
interface MfpMetadata {
  name: string
  description: string
  image: string
  attributes: { trait_type: string; value: any }[]
}

function OrderPreviewModal({ order, myAddrLower, platformFee, onClose, setToast, loadOrders }: {
  order: P2pOrder | null
  myAddrLower: string
  platformFee: number
  onClose: () => void
  setToast: (msg: string | null) => void
  loadOrders: () => void
}) {
  const [meta, setMeta] = useState<MfpMetadata | null>(null)
  const [metaLoading, setMetaLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!order) { setMeta(null); return }
    setMetaLoading(true)
    fetch(`${API_BASE}/nft/mfp/metadata/${order.tokenId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setMeta(data))
      .catch(err => console.warn('[Preview] metadata fetch failed:', err))
      .finally(() => setMetaLoading(false))
  }, [order?.tokenId])

  if (!order) return null

  const isOwnListing = !!myAddrLower && order.seller.toLowerCase() === myAddrLower
  const canBuy = !isOwnListing && order.status === 'PENDING'

  // Description format from API: "soulLine\n\n\"verseText\" — verseRef\n\nMission Founding Partner ..."
  const descParts = (meta?.description || '').split('\n\n')
  const soulLine = descParts[0] || ''
  const verseLine = descParts[1] || ''

  const royalty = (order.priceUsdt * ROYALTY_BPS) / 10000
  const fee = order.priceUsdt * (platformFee / 100)

  const handleBuy = async () => {
    if (!canBuy) return
    setSubmitting(true)
    try {
      const ethereum = (window as any).ethereum
      if (!ethereum) throw new Error('No wallet detected. Please install MetaMask.')
      const provider = new BrowserProvider(ethereum)
      const signer = await provider.getSigner()
      const usdt = new Contract(USDT_ADDR, USDT_ABI, signer)
      const p2p = new Contract(P2P_ESCROW_MFP, P2P_ABI, signer)

      // Network check + auto-switch to BSC Mainnet
      const network = await provider.getNetwork()
      if (Number(network.chainId) !== ACTIVE_CHAIN.chainId) {
        setToast(`Switching to ${ACTIVE_CHAIN.name}...`)
        try {
          await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ACTIVE_CHAIN.chainIdHex }] })
        } catch (switchErr: any) {
          if (switchErr?.code === 4902) {
            await ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: ACTIVE_CHAIN.chainIdHex,
                chainName: ACTIVE_CHAIN.name,
                nativeCurrency: ACTIVE_CHAIN.nativeCurrency,
                rpcUrls: ACTIVE_CHAIN.rpcUrls,
                blockExplorerUrls: [ACTIVE_CHAIN.explorerUrl],
              }],
            })
          } else {
            setToast(`Wrong network — please switch to ${ACTIVE_CHAIN.name} manually`)
            setTimeout(() => setToast(null), 6000)
            setSubmitting(false)
            return
          }
        }
      }

      const priceWei = parseUnits(order.priceUsdt.toString(), 6)
      setToast('Sign USDT approval...')
      const approveTx = await usdt.approve(P2P_ESCROW_MFP, priceWei)
      await approveTx.wait()

      setToast('Sign matchOrder tx...')
      const tx = await p2p.matchOrder(BigInt(order.onChainId))
      setToast(`Confirming on-chain... ${tx.hash.slice(0, 10)}...`)
      await tx.wait()
      setToast('Order matched ✓')
      setTimeout(() => setToast(null), 5000)
      onClose()
      setTimeout(loadOrders, 2000)
    } catch (err: any) {
      setToast('Error: ' + (err?.reason || err?.message || 'Unknown error'))
      setTimeout(() => setToast(null), 6000)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p2p-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="p2p-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="p2p-modal-header">
          <div>
            <div className="p2p-modal-title">{meta?.name || `MFP #${String(order.tokenId).padStart(4, '0')}`}</div>
            <div className="p2p-modal-subtitle">🪙 MFP-NFT • Token ID #{order.tokenId}</div>
          </div>
          <button className="p2p-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="p2p-modal-body">
          {/* Image — top, full-width square */}
          <div style={{ width: '100%', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', background: 'var(--cream)', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {metaLoading ? (
              <span style={{ color: 'var(--gray2)', fontSize: '0.8rem' }}>Loading image...</span>
            ) : meta?.image ? (
              <img src={meta.image} alt={meta.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ color: 'var(--gray2)', fontSize: '0.8rem' }}>No image available</span>
            )}
          </div>

          {/* Verse — soulLine (italic) + verse text */}
          {soulLine && (
            <div style={{ padding: '12px 16px', background: 'rgba(30,18,48,.5)', borderRadius: 8, marginBottom: 8, fontStyle: 'italic', fontSize: '0.78rem', lineHeight: 1.55, color: 'var(--cream)' }}>
              {soulLine}
            </div>
          )}
          {verseLine && (
            <div style={{ padding: '12px 16px', background: 'rgba(30,18,48,.5)', borderRadius: 8, marginBottom: 16, fontSize: '0.74rem', color: 'var(--gray2)', lineHeight: 1.55 }}>
              {verseLine}
            </div>
          )}

          {/* Pricing summary */}
          <div className="p2p-modal-summary">
            <div className="p2p-summary-row">
              <span>Price</span>
              <span className="p2p-summary-val">${order.priceUsdt.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</span>
            </div>
            <div className="p2p-summary-row">
              <span>Royalty (5%)</span>
              <span className="p2p-summary-val" style={{ color: 'var(--warning)' }}>-${royalty.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
            </div>
            <div className="p2p-summary-row">
              <span>Platform Fee ({platformFee}%)</span>
              <span className="p2p-summary-val" style={{ color: 'var(--warning)' }}>-${fee.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
            </div>
            <div className="p2p-summary-divider" />
            {isOwnListing ? (
              <div className="p2p-summary-row p2p-summary-total">
                <span>Seller Receives</span>
                <span className="p2p-summary-val" style={{ color: 'var(--gold)' }}>${order.receivingUsdt.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</span>
              </div>
            ) : (
              <div className="p2p-summary-row p2p-summary-total">
                <span>Buyer Pays</span>
                <span className="p2p-summary-val" style={{ color: 'var(--gold)' }}>${order.priceUsdt.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT</span>
              </div>
            )}
          </div>

          {/* Status note */}
          {order.status !== 'PENDING' && (
            <div style={{ marginTop: 12, padding: '8px 12px', textAlign: 'center', background: 'var(--cream)', borderRadius: 8, fontSize: '0.75rem', color: 'var(--gray2)' }}>
              Order Status: <strong>{order.status}</strong>
            </div>
          )}
          {isOwnListing && order.status === 'PENDING' && (
            <div style={{ marginTop: 12, padding: '8px 12px', textAlign: 'center', background: 'var(--cream)', borderRadius: 8, fontSize: '0.75rem', color: 'var(--gray2)' }}>
              This is your own listing — preview only
            </div>
          )}
        </div>

        <div className="p2p-modal-footer">
          <button className="p2p-modal-btn-cancel" onClick={onClose}>Close</button>
          {canBuy && (
            <button
              className="p2p-modal-btn-submit p2p-modal-btn-buy"
              disabled={submitting}
              onClick={handleBuy}
            >
              {submitting ? 'Processing...' : `Buy for $${order.priceUsdt.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
