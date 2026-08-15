'use client'

/**
 * Rank bonus — the member mints their own.
 *
 * The agreement, from the Owner: reaching a rank shows a notice on the member's own
 * screen and they press MINT; the contract mints into their wallet. The admin button on
 * /nft-rewards stays, but only for awards given outside the KPI programme — a gift, not
 * the mechanism.
 *
 * Until now only the plumbing existed. RankBonusClaim was deployed on 2026-08-12 with the
 * keeper holding AWARDER_ROLE, and nothing on the member side ever called it, so in
 * practice every rank bonus still had to be minted by an admin typing a wallet address —
 * exactly the shape the Owner asked to replace.
 *
 * Signing is the member's own. The server never holds a key that can mint to somebody's
 * wallet, and the entitlement is read from the contract rather than from our database:
 * a double mint is unrecoverable, so the thing that decides has to be the thing that mints.
 */

import { useCallback, useEffect, useState } from 'react'
import { getActiveAddresses, getActiveChain } from '@missionchain/sdk'

const A = getActiveAddresses() as Record<string, string>
const CHAIN = getActiveChain()

const ABI = [
  'function claimableOf(address user) view returns (uint8[] ranks, uint256[] tiers, uint256[] quantities)',
  'function claim(uint8 rank)',
  'function paused() view returns (bool)',
]

/** Matches the contract's Rank enum; index 0 is the unused NONE slot. */
const RANK_NAME = ['—', 'Builder', 'Connector', 'Champion', 'Ambassador', 'Legend']
const TIER_NAME: Record<number, string> = { 1: 'Builder', 2: 'Maker', 3: 'Luminary' }

type Claimable = { rank: number; tier: number; quantity: number }

export default function RankBonusClaimPanel({ address }: { address?: string }) {
  const [items, setItems] = useState<Claimable[]>([])
  const [paused, setPaused] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null)

  const contractAddr = A.RankBonusClaim
  const live = Boolean(contractAddr) && !/^0x0+$/.test(contractAddr || '')

  const load = useCallback(async () => {
    if (!live || !address) { setItems([]); return }
    const { JsonRpcProvider, Contract } = await import('ethers')
    // Each endpoint in turn: a dead host must not make an earned award look absent.
    for (const url of CHAIN.rpcUrls) {
      try {
        const c = new Contract(contractAddr, ABI, new JsonRpcProvider(url))
        const [ranks, tiers, quantities] = await c.claimableOf(address)
        setItems(ranks.map((r: bigint, i: number) => ({
          rank: Number(r),
          tier: Number(tiers[i]),
          quantity: Number(quantities[i]),
        })))
        setPaused(await c.paused().catch(() => false))
        return
      } catch { /* next endpoint */ }
    }
  }, [address, contractAddr, live])

  useEffect(() => { load() }, [load])

  const claim = async (rank: number) => {
    setBusy(rank); setMsg(null)
    try {
      const eth = (window as any).ethereum
      if (!eth) throw new Error('No wallet found — connect one to mint')
      await eth.request({ method: 'eth_requestAccounts' })
      const chainId = await eth.request({ method: 'eth_chainId' })
      if (parseInt(chainId, 16) !== CHAIN.chainId) {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.chainIdHex }] })
      }
      const { BrowserProvider, Contract } = await import('ethers')
      const signer = await new BrowserProvider(eth).getSigner()
      const tx = await new Contract(contractAddr, ABI, signer).claim(rank)
      await tx.wait()
      setMsg({ ok: true, text: `${RANK_NAME[rank]} bonus minted to your wallet`, hash: tx.hash })
      await load()
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.reason || e?.message || 'Mint failed' })
    }
    setBusy(null)
  }

  // Nothing earned, nothing owed — say nothing. A permanently empty card trains people to
  // ignore the place their reward will eventually appear.
  if (!live || !address || items.length === 0) return null

  return (
    <div className="nft-section-card" style={{ marginBottom: 16 }}>
      <div className="nft-section-header">
        <span className="nft-section-title">🎖️ Rank bonus ready to mint</span>
      </div>

      <div className="nft-pool-note">
        You reached {items.length === 1 ? 'a rank' : 'these ranks'} and the bonus is waiting.
        Minting sends the NFTs straight to your own wallet — you sign it, nobody mints on
        your behalf. You pay only the network fee.
      </div>

      {paused && (
        <div className="nft-pool-note" style={{ color: '#ffb400' }}>
          Minting is paused right now. Your award is recorded on chain and stays claimable.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        {items.map((it) => (
          <div key={it.rank} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap',
            padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
          }}>
            <div>
              <div style={{ fontWeight: 700 }}>{RANK_NAME[it.rank] ?? `Rank ${it.rank}`}</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.75 }}>
                {it.quantity}× {TIER_NAME[it.tier] ?? `Tier ${it.tier}`} Community NFT
              </div>
            </div>
            <button
              className="nft-claim-btn"
              disabled={busy !== null || paused}
              onClick={() => claim(it.rank)}
            >
              {busy === it.rank ? 'Minting…' : 'MINT'}
            </button>
          </div>
        ))}
      </div>

      {msg && (
        <div className="nft-pool-note" style={{ color: msg.ok ? '#7ddc9a' : '#ff8f8f', marginTop: 10 }}>
          {msg.text}
          {msg.hash && (
            <>
              {' — '}
              <a
                href={`${CHAIN.explorerUrl}/tx/${msg.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="swap-msg-link"
                title={msg.hash}
              >
                <span className="swap-msg-hash">{msg.hash}</span>{' ↗'}
              </a>
            </>
          )}
        </div>
      )}
    </div>
  )
}
