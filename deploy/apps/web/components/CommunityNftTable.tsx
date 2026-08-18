'use client'

/**
 * The member's Community NFTs, read from the token contract itself.
 *
 * Two things were broken here. The tier counts called `balanceOf(address, tier)` — the
 * two-argument ERC-1155 signature — against CommunityNFTv2, which is ERC-721 and takes
 * one argument. Every call reverted into a `.catch(() => 0n)`, so a wallet holding three
 * NFTs showed "-" with no error anywhere. And the fallback, the NFTItem table, holds no
 * COMMUNITY rows at all because the indexer that fills it needs an archive RPC.
 *
 * So this reads the contract directly: ERC721Enumerable gives the serials a wallet owns,
 * and `meta(tokenId)` carries tier, mint time and expiry. No indexer, no archive endpoint,
 * nothing to fall behind.
 */

import { useCallback, useEffect, useState } from 'react'
import { getActiveAddresses, getActiveChain } from '@missionchain/sdk'

const A = getActiveAddresses() as Record<string, string>
const CHAIN = getActiveChain()

const ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function meta(uint256 tokenId) view returns (uint8 tier, uint64 mintTime, uint64 expiryTime)',
]

/**
 * The reward pool. A minted NFT earns nothing until it is enrolled here — the pool has no
 * hook into the NFT contract, so it cannot see a mint happen. `NftRewardPoolV2` says so in
 * its own comment: "Earning starts now, not at mint."
 *
 * `enroll` is permissionless by design: it can only ever credit the token's actual owner,
 * so letting anyone call it costs nothing and means a holder is never stuck waiting for an
 * operator. That is why this button exists on the member's own page.
 */
const POOL_ABI = [
  'function enroll(uint256 tokenId)',
  'function tokenWeight(uint256) view returns (uint256)',
]

const TIER_NAME: Record<number, string> = { 1: 'Builder', 2: 'Maker', 3: 'Luminary' }
const TIER_COLOR: Record<number, string> = { 1: '#29B6F6', 2: '#476DBC', 3: '#849ED4' }

const PAGE_SIZE = 10

type Row = {
  tokenId: string
  tier: number
  mintTime: number   // unix seconds
  expiryTime: number // unix seconds
  /** Weight this token carries in the reward pool. Zero until it is enrolled. */
  weight: bigint
}

/** Mint tx hashes, when the API has them. Absent is normal, not an error. */
type TxMap = Record<string, string>

function remaining(expiry: number): { text: string; expired: boolean } {
  const secs = expiry - Math.floor(Date.now() / 1000)
  if (secs <= 0) return { text: 'Expired', expired: true }
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  if (d > 0) return { text: `${d}d ${h}h`, expired: false }
  const m = Math.floor((secs % 3600) / 60)
  return { text: `${h}h ${m}m`, expired: false }
}

export default function CommunityNftTable({ address, txHashes = {} }: {
  address?: string
  txHashes?: TxMap
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const nft = A.CommunityNFTv2 || A.CommunityNFT
    if (!address || !nft || /^0x0+$/.test(nft)) { setRows([]); return }

    const { JsonRpcProvider, Contract } = await import('ethers')
    for (const url of CHAIN.rpcUrls) {
      try {
        const c = new Contract(nft, ABI, new JsonRpcProvider(url))
        const count = Number(await c.balanceOf(address))
        if (count === 0) { setRows([]); setError(null); return }

        const ids: bigint[] = await Promise.all(
          Array.from({ length: count }, (_, i) => c.tokenOfOwnerByIndex(address, i)),
        )
        const metas = await Promise.all(ids.map((id) => c.meta(id)))

        // Whether each token is actually earning. A holder seeing "Active" while the pool
        // gives it zero weight is the more expensive kind of wrong.
        const poolAddr = A.CommunityNFTRewardPool
        let weights: bigint[] = ids.map(() => 0n)
        if (poolAddr && !/^0x0+$/.test(poolAddr)) {
          const pool = new Contract(poolAddr, POOL_ABI, new JsonRpcProvider(url))
          weights = await Promise.all(ids.map((id) => pool.tokenWeight(id).catch(() => 0n)))
        }

        const out: Row[] = ids.map((id, i) => ({
          tokenId: id.toString(),
          tier: Number(metas[i].tier ?? metas[i][0]),
          mintTime: Number(metas[i].mintTime ?? metas[i][1]),
          expiryTime: Number(metas[i].expiryTime ?? metas[i][2]),
          weight: weights[i] as bigint,
        }))
        // Newest first — the one just minted is the one being looked for.
        out.sort((a, b) => b.mintTime - a.mintTime)
        setRows(out)
        setError(null)
        return
      } catch { /* next endpoint */ }
    }
    setError('Could not reach any BSC endpoint')
  }, [address])

  useEffect(() => { load() }, [load])

  /** Put one token to work in the reward pool. The member signs; anyone could. */
  const enroll = async (tokenId: string) => {
    setBusy(tokenId); setNote(null)
    try {
      const eth = (window as any).ethereum
      if (!eth) throw new Error('No wallet found')
      await eth.request({ method: 'eth_requestAccounts' })
      const chainId = await eth.request({ method: 'eth_chainId' })
      if (parseInt(chainId, 16) !== CHAIN.chainId) {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.chainIdHex }] })
      }
      const { BrowserProvider, Contract } = await import('ethers')
      const signer = await new BrowserProvider(eth).getSigner()
      const tx = await new Contract(A.CommunityNFTRewardPool, POOL_ABI, signer).enroll(tokenId)
      await tx.wait()
      setNote({ ok: true, text: `#${tokenId} is now earning from the reward pool.` })
      await load()
    } catch (e: any) {
      const why = e?.reason || e?.revert?.args?.[0] || e?.shortMessage || e?.message || 'Failed'
      setNote({ ok: false, text: String(why).replace(/^execution reverted:?\s*/i, '') })
    }
    setBusy(null)
  }

  if (!address) return null
  if (error) {
    return <div className="nft-pool-note" style={{ color: '#FFB200' }}>{error}</div>
  }
  if (rows === null) return <div className="nft-pool-note">Reading your NFTs…</div>
  if (rows.length === 0) return null

  const pages = Math.ceil(rows.length / PAGE_SIZE)
  const slice = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="nft-section-card" style={{ marginTop: 14 }}>
      <div className="nft-section-header">
        <span className="nft-section-title">My Community NFTs — {rows.length} total</span>
      </div>

      <div style={{ overflowX: 'auto', marginTop: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.7 }}>
              <th style={{ padding: '8px 10px' }}>Date</th>
              <th style={{ padding: '8px 10px' }}>Time</th>
              <th style={{ padding: '8px 10px' }}>Type</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>Serial</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>Time left</th>
              <th style={{ padding: '8px 10px' }}>Mint transaction</th>
              <th style={{ padding: '8px 10px' }}>Reward pool</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
              const when = new Date(r.mintTime * 1000)
              const left = remaining(r.expiryTime)
              const hash = txHashes[r.tokenId]
              return (
                <tr key={r.tokenId} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 10px', fontFamily: 'var(--font-m)' }}>
                    {when.toISOString().slice(0, 10)}
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'var(--font-m)' }}>
                    {when.toISOString().slice(11, 19)} UTC
                  </td>
                  <td style={{ padding: '8px 10px', color: TIER_COLOR[r.tier], fontWeight: 700 }}>
                    {TIER_NAME[r.tier] ?? `Tier ${r.tier}`}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--font-m)' }}>
                    #{r.tokenId}
                  </td>
                  <td style={{
                    padding: '8px 10px', textAlign: 'right', fontFamily: 'var(--font-m)',
                    color: left.expired ? '#FF8F9D' : undefined,
                  }}>
                    {left.text}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    {/*
                      The exact mint transaction comes from the event indexer, which is
                      currently unable to read logs. Rather than an empty cell, the token's
                      own explorer page is linked — it shows the mint and every transfer
                      since — and it is labelled for what it is instead of pretending to be
                      a transaction hash.
                    */}
                    {hash ? (
                      <a href={`${CHAIN.explorerUrl}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
                         className="swap-msg-link" title={hash}>
                        <span className="swap-msg-hash">{hash.slice(0, 10)}…{hash.slice(-8)}</span>{' ↗'}
                      </a>
                    ) : (
                      <a href={`${CHAIN.explorerUrl}/token/${A.CommunityNFTv2 || A.CommunityNFT}?a=${r.tokenId}`}
                         target="_blank" rel="noopener noreferrer" className="swap-msg-link">
                        View on BscScan ↗
                      </a>
                    )}
                  </td>
                  {/*
                    Minting does not enrol. The pool has no hook into the NFT contract, so
                    until `enroll` is called the token carries zero weight and earns
                    nothing — which is why Pool Weight read "-" with three NFTs held.
                  */}
                  <td style={{ padding: '8px 10px' }}>
                    {r.weight > 0n ? (
                      <span style={{ color: '#7ddc9a' }}>Earning</span>
                    ) : left.expired ? (
                      <span style={{ opacity: 0.5 }}>—</span>
                    ) : (
                      <button
                        className="nft-claim-btn"
                        disabled={busy !== null}
                        onClick={() => enroll(r.tokenId)}
                      >
                        {busy === r.tokenId ? 'Activating…' : 'Activate'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {rows.some((r) => r.weight === 0n && r.expiryTime * 1000 > Date.now()) && (
        <div className="nft-pool-note" style={{ marginTop: 10 }}>
          An NFT starts earning only once it is activated in the reward pool — minting alone
          does not do it. Press <strong>Activate</strong> on each one; you sign it yourself
          and pay only the network fee.
        </div>
      )}

      {note && (
        <div className="nft-pool-note" style={{ color: note.ok ? '#7ddc9a' : '#FF8F9D', marginTop: 8 }}>
          {note.text}
        </div>
      )}

      {pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
          <button className="nft-claim-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← Previous
          </button>
          <span style={{ fontSize: '0.78rem', opacity: 0.75 }}>
            Page {page + 1} of {pages}
          </span>
          <button className="nft-claim-btn" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
