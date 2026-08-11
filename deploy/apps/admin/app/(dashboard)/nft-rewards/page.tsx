'use client';

import { useCallback, useEffect, useState } from 'react';
import { getActiveAddresses, getActiveChain } from '@missionchain/sdk';
import {
  fetchNftRewardMilestones,
  fetchNftRewardPools,
  fetchCommunityGrants,
  precheckCommunityGrant,
  issueCommunityGrant,
} from '@/lib/api';

/**
 * NFT Rewards — the two programmes that had no way to be paid.
 *
 * `ClaimRewardsV2.mintMilestoneNFT` / `mintRankBonus` and the two pools' `distribute`
 * have existed on chain since their deploy, and nothing in the platform ever called them.
 * The reward engine could work out who was owed what and then had nowhere to send it.
 *
 * Signing happens here, in the operator's own wallet — never on the server. Minting is
 * irreversible and distributing moves real MIC, and the roles that authorise them
 * (CREDITOR_ROLE, DISTRIBUTOR_ROLE) belong to wallets whose keys should not exist in a
 * server's environment. The API works out the numbers; the key holder decides.
 */

const A = getActiveAddresses() as Record<string, string>;
const CHAIN = getActiveChain();
const ZERO = '0x0000000000000000000000000000000000000000';

const CLAIM_REWARDS_ABI = [
  'function mintMilestoneNFT(address user, uint256 milestoneIndex)',
  'function mintRankBonus(address user, uint256 tier, uint256 quantity)',
  'function CREDITOR_ROLE() view returns (bytes32)',
  'function hasRole(bytes32,address) view returns (bool)',
];

const POOL_ABI = [
  'function distribute(address[] recipients, uint256[] amounts)',
  'function DISTRIBUTOR_ROLE() view returns (bytes32)',
  'function hasRole(bytes32,address) view returns (bool)',
];

const TIER_NAME: Record<number, string> = { 1: 'Builder', 2: 'Maker', 3: 'Luminary' };

/**
 * All three tiers CommunityNFTv2 defines. The Owner initially described this list as
 * two tiers, then confirmed on 2026-08-11 that all three are grantable — which also
 * matches the three weekly limits they specified (10 / 5 / 2).
 */
const GRANT_TIERS = [1, 2, 3] as const;

/** White Paper §B.5.1 — the one-time batch each Community Growth Award rank earns. */
const RANK_BONUS = [
  { rank: 'Builder', tier: 1, quantity: 3 },
  { rank: 'Connector', tier: 2, quantity: 3 },
  { rank: 'Champion', tier: 3, quantity: 3 },
  { rank: 'Ambassador', tier: 3, quantity: 5 },
  { rank: 'Legend', tier: 3, quantity: 10 },
];

const short = (a: string) => `${a.slice(0, 10)}…${a.slice(-8)}`;

async function walletSigner() {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error('No wallet found — install MetaMask');
  await eth.request({ method: 'eth_requestAccounts' });
  const chainId = await eth.request({ method: 'eth_chainId' });
  if (chainId !== '0x38') throw new Error('Switch to BSC Mainnet (chain 56)');
  const { BrowserProvider } = await import('ethers');
  return (await new BrowserProvider(eth).getSigner());
}

export default function NftRewardsPage() {
  const [milestones, setMilestones] = useState<any>(null);
  const [pools, setPools] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [rankWallet, setRankWallet] = useState('');
  const [rankIndex, setRankIndex] = useState(0);

  // ── Community NFT discretionary grants (Path 2) ──
  const [grants, setGrants] = useState<any>(null);
  const [gWallet, setGWallet] = useState('');
  const [gTier, setGTier] = useState(1);
  const [gQty, setGQty] = useState(1);
  const [gNote, setGNote] = useState('');
  const [gCheck, setGCheck] = useState<{ allowed: boolean; reason?: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, p, g] = await Promise.all([
      fetchNftRewardMilestones().catch((e) => ({ error: e?.message || 'failed' })),
      fetchNftRewardPools().catch((e) => ({ error: e?.message || 'failed' })),
      fetchCommunityGrants().catch((e) => ({ error: e?.message || 'failed' })),
    ]);
    setMilestones(m);
    setPools(p);
    setGrants(g);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const mintMilestone = async (wallet: string, index: number, tierName: string) => {
    const key = `ms-${wallet}-${index}`;
    setBusy(key); setMsg(null);
    try {
      const signer = await walletSigner();
      const { Contract } = await import('ethers');
      const c = new Contract(A.ClaimRewardsV2, CLAIM_REWARDS_ABI, signer);

      // Fail here rather than as an opaque revert: only CREDITOR_ROLE may mint, and the
      // operator opening this page is often not the wallet that holds it.
      const role = await c.CREDITOR_ROLE();
      const me = await signer.getAddress();
      if (!(await c.hasRole(role, me))) {
        throw new Error(`${short(me)} does not hold CREDITOR_ROLE — connect the creditor wallet`);
      }

      const tx = await c.mintMilestoneNFT(wallet, index);
      await tx.wait();
      setMsg({ ok: true, text: `Minted a ${tierName} NFT to ${short(wallet)} — ${tx.hash.slice(0, 12)}…` });
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.message || 'Mint failed' });
    }
    setBusy('');
  };

  const mintRank = async () => {
    setBusy('rank'); setMsg(null);
    try {
      if (!/^0x[a-fA-F0-9]{40}$/.test(rankWallet.trim())) throw new Error('Enter a valid wallet address');
      const { rank, tier, quantity } = RANK_BONUS[rankIndex];
      const signer = await walletSigner();
      const { Contract } = await import('ethers');
      const c = new Contract(A.ClaimRewardsV2, CLAIM_REWARDS_ABI, signer);

      const role = await c.CREDITOR_ROLE();
      const me = await signer.getAddress();
      if (!(await c.hasRole(role, me))) {
        throw new Error(`${short(me)} does not hold CREDITOR_ROLE — connect the creditor wallet`);
      }

      const tx = await c.mintRankBonus(rankWallet.trim(), tier, quantity);
      await tx.wait();
      setMsg({ ok: true, text: `Minted ${quantity}× ${TIER_NAME[tier]} for rank ${rank} — ${tx.hash.slice(0, 12)}…` });
      setRankWallet('');
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.message || 'Mint failed' });
    }
    setBusy('');
  };


  /**
   * Ask the API whether this grant is within the weekly limits before the Owner commits.
   * The API re-checks on submit regardless — this only buys a friendlier message.
   */
  const runPrecheck = async (wallet: string, tier: number, qty: number) => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet.trim())) { setGCheck(null); return; }
    try {
      const r: any = await precheckCommunityGrant({ wallet: wallet.trim(), tier, quantity: qty });
      setGCheck(r?.data ?? null);
    } catch { setGCheck(null); }
  };

  /**
   * Issues the allowance only. No NFT is minted here — the recipient mints it to their own
   * wallet, which is what separates this path from the automatic KPI awards above.
   */
  const issueGrant = async () => {
    setBusy('grant'); setMsg(null);
    try {
      if (!/^0x[a-fA-F0-9]{40}$/.test(gWallet.trim())) throw new Error('Enter a valid wallet address');
      if (!Number.isInteger(gQty) || gQty < 1) throw new Error('Quantity must be at least 1');
      const r: any = await issueCommunityGrant({
        wallet: gWallet.trim(), tier: gTier, quantity: gQty, note: gNote.trim(),
      });
      setMsg({
        ok: true,
        text: `Granted ${r?.data?.record?.quantity ?? gQty}× ${TIER_NAME[gTier]} to ${short(gWallet.trim())}. `
            + 'The recipient mints it from their own wallet.',
      });
      setGWallet(''); setGQty(1); setGNote(''); setGCheck(null);
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Grant failed' });
    }
    setBusy('');
  };

  const distribute = async (which: 'community' | 'mfp') => {
    setBusy(`dist-${which}`); setMsg(null);
    try {
      const plan = pools?.data?.plan;
      if (!plan) throw new Error('No distribution plan — nothing to pay out');
      const rows = (which === 'community' ? plan.community : plan.mfp)
        .filter((r: any) => BigInt(r.amountWei) > 0n);
      if (rows.length === 0) throw new Error('Every allocation in this pool is zero');

      const address = which === 'community'
        ? pools.data.pools.community.address
        : pools.data.pools.mfp.address;

      const signer = await walletSigner();
      const { Contract } = await import('ethers');
      const c = new Contract(address, POOL_ABI, signer);

      const role = await c.DISTRIBUTOR_ROLE();
      const me = await signer.getAddress();
      if (!(await c.hasRole(role, me))) {
        throw new Error(`${short(me)} does not hold DISTRIBUTOR_ROLE on this pool`);
      }

      const tx = await c.distribute(
        rows.map((r: any) => r.wallet),
        rows.map((r: any) => BigInt(r.amountWei)),
      );
      await tx.wait();
      setMsg({ ok: true, text: `Paid ${rows.length} wallets — ${tx.hash.slice(0, 12)}…` });
      load();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.shortMessage || e?.message || 'Distribution failed' });
    }
    setBusy('');
  };

  const notDeployed = !A.ClaimRewardsV2 || A.ClaimRewardsV2 === ZERO;

  return (
    <div>
      <div className="page-title">NFT Rewards</div>
      <p style={{ fontSize: '0.68rem', color: 'var(--gray2)', lineHeight: 1.7, maxWidth: 780, marginBottom: 16 }}>
        Community NFTs earned through referral milestones and Community Growth Award ranks,
        and the MIC held by the two emission-funded reward pools. Every transaction here is
        signed from your own wallet — the server holds no key for either programme.
      </p>

      {msg && (
        <div style={{
          margin: '12px 0', padding: '11px 14px', borderRadius: 8, fontSize: '0.68rem',
          color: msg.ok ? 'var(--success)' : 'var(--error)',
          background: msg.ok ? 'rgba(69,217,160,.10)' : 'rgba(242,109,139,.10)',
          border: `1px solid ${msg.ok ? 'rgba(69,217,160,.3)' : 'rgba(242,109,139,.3)'}`,
        }}>{msg.text}</div>
      )}

      {notDeployed && (
        <div className="card"><div style={{ fontSize: '0.7rem', color: 'var(--warning)' }}>
          ClaimRewardsV2 is not configured for this network.
        </div></div>
      )}

      {/* ── Milestone NFTs ── */}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>Referral Milestones</span>
          {milestones?.data && (
            <span style={{ fontSize: '0.6rem', fontWeight: 400, color: 'var(--gray2)' }}>
              {milestones.data.totalPending} NFT{milestones.data.totalPending === 1 ? '' : 's'} owed
            </span>
          )}
          <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={load} disabled={loading}>
            ↻ Refresh
          </button>
        </div>

        <p style={{ fontSize: '0.62rem', color: 'var(--gray2)', lineHeight: 1.65, marginBottom: 10 }}>
          A direct referral counts once they have bought{' '}
          <strong>${milestones?.data?.qualifyingPurchaseUsdt ?? 100}</strong> or more in total
          (Pre-Sale or MICE — SEED does not count). Tiers are earned at 3, 5 and 10 qualifying
          referrals, and the count repeats each time a circle of ten closes. What has already
          been minted is read from the contract, not from our database, so a mint that was
          recorded badly can never cause a second one.
        </p>

        {loading && <div style={{ fontSize: '0.66rem', color: 'var(--gray2)' }}>Reading chain…</div>}
        {milestones?.error && (
          <div style={{ fontSize: '0.66rem', color: 'var(--error)' }}>{milestones.error}</div>
        )}

        {milestones?.data?.proposals?.length === 0 && !loading && (
          <div style={{ fontSize: '0.66rem', color: 'var(--gray2)', padding: '10px 0' }}>
            Nobody has reached a milestone yet.
          </div>
        )}

        {milestones?.data?.proposals?.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.64rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--gray2)' }}>
                  <th style={{ padding: '6px 8px' }}>Wallet</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Qualifying F1</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Circles</th>
                  <th style={{ padding: '6px 8px' }}>Owed</th>
                  <th style={{ padding: '6px 8px' }} />
                </tr>
              </thead>
              <tbody>
                {milestones.data.proposals.map((pr: any) => (
                  <tr key={pr.wallet} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px', fontFamily: 'var(--font-m)' }}>
                      <a href={`${CHAIN.explorerUrl}/address/${pr.wallet}`} target="_blank"
                         rel="noopener noreferrer" style={{ color: 'var(--gold)', textDecoration: 'none' }}>
                        {short(pr.wallet)} ↗
                      </a>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'var(--font-m)' }}>{pr.qualifyingF1}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--gray2)' }}>{pr.completedCircles}</td>
                    <td style={{ padding: '8px' }}>
                      {pr.pending.map((m: any, i: number) => (
                        <span key={i} style={{
                          display: 'inline-block', marginRight: 5, marginBottom: 3, padding: '2px 7px',
                          borderRadius: 4, fontSize: '0.55rem', background: 'rgba(240,181,74,.14)', color: 'var(--warning)',
                        }}>{m.tierName}</span>
                      ))}
                    </td>
                    <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                      {pr.pending.map((m: any, i: number) => (
                        <button
                          key={i}
                          className="btn btn-primary btn-sm"
                          style={{ marginRight: 5 }}
                          disabled={busy === `ms-${pr.wallet}-${m.milestoneIndex}`}
                          onClick={() => mintMilestone(pr.wallet, m.milestoneIndex, m.tierName)}
                        >
                          {busy === `ms-${pr.wallet}-${m.milestoneIndex}` ? '…' : `Mint ${m.tierName}`}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Rank bonus ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Community Growth Award — rank bonus</div>
        <p style={{ fontSize: '0.62rem', color: 'var(--gray2)', lineHeight: 1.65, marginBottom: 10 }}>
          A one-time batch issued when a member reaches a rank. Rank eligibility is decided
          off chain and approved before minting — the contract does not track ranks, so this
          is a deliberate act, not an automatic one. Each batch is capped on chain, so a
          mistyped quantity cannot mint thousands.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={rankWallet}
            onChange={(e) => setRankWallet(e.target.value)}
            placeholder="0x… recipient wallet"
            style={{ flex: '1 1 320px', fontFamily: 'var(--font-m)', fontSize: '0.66rem' }}
          />
          <select
            value={rankIndex}
            onChange={(e) => setRankIndex(Number(e.target.value))}
            style={{ fontSize: '0.66rem' }}
          >
            {RANK_BONUS.map((r, i) => (
              <option key={r.rank} value={i}>
                {r.rank} — {r.quantity}× {TIER_NAME[r.tier]}
              </option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={mintRank} disabled={busy === 'rank' || notDeployed}>
            {busy === 'rank' ? 'Minting…' : 'Mint rank bonus'}
          </button>
        </div>
      </div>

      {/* ── Community NFTs Granted (Path 2 — Owner discretion) ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Community NFTs Granted</div>
        <p style={{ fontSize: '0.62rem', color: 'var(--gray2)', lineHeight: 1.65, marginBottom: 10 }}>
          Award a Community NFT outside the automatic KPI programmes, for a case those do not
          cover. This issues an allowance only — nothing is minted here. The recipient is shown
          the award and mints it to their own wallet.
        </p>

        {/*
          Stating this plainly is not optional. An operator who reads "limit" will assume the
          chain enforces it, and act accordingly.
        */}
        <div style={{
          fontSize: '0.6rem', color: 'var(--warning)', lineHeight: 1.6, marginBottom: 12,
          padding: '8px 10px', borderRadius: 6,
          border: '1px solid var(--warning)', background: 'rgba(255,180,0,0.06)',
        }}>
          <strong>Operational limits, not on-chain rules.</strong> The weekly caps below are
          enforced by this platform&apos;s backend only. The contracts do not know about them:
          <code style={{ margin: '0 4px' }}>CommunityNFTv2.mint</code> checks only MINTER_ROLE.
          Any holder of a minting key can bypass these caps by calling the contract directly,
          and such a mint will not appear in the ledger below. Enforcing them on chain would
          require a new contract.
        </div>

        {grants?.error && (
          <div style={{ fontSize: '0.66rem', color: 'var(--error)', marginBottom: 10 }}>{grants.error}</div>
        )}

        {grants?.data && (
          <>
            {/* This week's remaining allowance, per tier. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {grants.data.usage.tiers.map((t: any) => {
                const left = t.weeklyLimit - t.used;
                return (
                  <div key={t.tier} style={{
                    padding: '6px 10px', borderRadius: 6, fontSize: '0.62rem',
                    border: '1px solid var(--line)', background: 'var(--bg2)',
                  }}>
                    <strong>{t.name}</strong>{' '}
                    <span style={{ color: left > 0 ? 'var(--gray2)' : 'var(--error)' }}>
                      {t.used} / {t.weeklyLimit} this week
                    </span>
                  </div>
                );
              })}
              <div style={{
                padding: '6px 10px', borderRadius: 6, fontSize: '0.62rem',
                border: '1px solid var(--line)', background: 'var(--bg2)', color: 'var(--gray2)',
              }}>
                Max {grants.data.usage.perWalletLimit} per wallet per week · week of {grants.data.usage.weekKey}
              </div>
            </div>

            {/* Self-mint readiness — the recipient's button depends on this. */}
            {grants.data.selfMint && !grants.data.selfMint.enabled && (
              <div style={{
                fontSize: '0.6rem', color: 'var(--gray2)', lineHeight: 1.6, marginBottom: 12,
                padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line)',
              }}>
                <strong>Recipient self-mint is not active yet.</strong> {grants.data.selfMint.reason}
                {' '}Grants issued now are stored and stay claimable — recipients will be able to
                mint as soon as it is enabled.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
              <input
                value={gWallet}
                onChange={(e) => { setGWallet(e.target.value); runPrecheck(e.target.value, gTier, gQty); }}
                placeholder="0x… recipient wallet"
                style={{ flex: '1 1 300px', fontFamily: 'var(--font-m)', fontSize: '0.66rem' }}
              />
              <select
                value={gTier}
                onChange={(e) => { const t = Number(e.target.value); setGTier(t); runPrecheck(gWallet, t, gQty); }}
                style={{ fontSize: '0.66rem' }}
              >
                {GRANT_TIERS.map((t) => (
                  <option key={t} value={t}>{TIER_NAME[t]}</option>
                ))}
              </select>
              <input
                type="number" min={1} value={gQty}
                onChange={(e) => { const q = Number(e.target.value); setGQty(q); runPrecheck(gWallet, gTier, q); }}
                placeholder="Qty"
                style={{ width: 80, fontSize: '0.66rem' }}
              />
            </div>

            {/*
              The per-wallet cap of 1 per week means a quantity above 1 can never be
              issued in a single week. Saying so here beats letting the operator find out
              from a rejection after they have filled the form in.
            */}
            <div style={{ fontSize: '0.6rem', color: 'var(--gray2)', marginBottom: 8 }}>
              Quantity above 1 will be rejected while the per-wallet limit is 1 NFT per week.
            </div>

            <input
              value={gNote}
              onChange={(e) => setGNote(e.target.value)}
              placeholder="Note — why this NFT is being granted"
              style={{ width: '100%', fontSize: '0.66rem', marginBottom: 8 }}
            />

            {gCheck && !gCheck.allowed && (
              <div style={{ fontSize: '0.62rem', color: 'var(--error)', marginBottom: 8 }}>
                {gCheck.reason}
              </div>
            )}

            <button
              className="btn btn-primary btn-sm"
              onClick={issueGrant}
              disabled={busy === 'grant' || !gWallet.trim() || (gCheck ? !gCheck.allowed : false)}
            >
              {busy === 'grant' ? 'Granting…' : 'Grant Community NFT'}
            </button>

            {/* Ledger */}
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: '0.62rem', color: 'var(--gray2)', marginBottom: 6 }}>
                Grant history — {grants.data.history.length === 0 ? 'no grants issued yet' : `${grants.data.history.length} most recent`}
              </div>
              {grants.data.history.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '0.62rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Recipient</th>
                        <th style={{ textAlign: 'left' }}>Tier</th>
                        <th style={{ textAlign: 'right' }}>Qty</th>
                        <th style={{ textAlign: 'left' }}>Status</th>
                        <th style={{ textAlign: 'left' }}>Note</th>
                        <th style={{ textAlign: 'left' }}>Granted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grants.data.history.map((g: any) => (
                        <tr key={g.id}>
                          <td style={{ fontFamily: 'var(--font-m)' }}>{short(g.wallet)}</td>
                          <td>{TIER_NAME[g.tier] ?? g.tier}</td>
                          <td style={{ textAlign: 'right' }}>{g.quantity}</td>
                          <td style={{ color: g.status === 'MINTED' ? 'var(--success)' : 'var(--gray2)' }}>
                            {g.status === 'MINTED' ? 'Minted' : 'Awaiting recipient'}
                            {g.overLimit && <span style={{ color: 'var(--error)' }}> · over limit</span>}
                          </td>
                          <td style={{ color: 'var(--gray2)' }}>{g.note || '—'}</td>
                          <td style={{ color: 'var(--gray2)' }}>{new Date(g.grantedAt).toISOString().slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Reward pools ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">Reward Pools</div>
        <p style={{ fontSize: '0.62rem', color: 'var(--gray2)', lineHeight: 1.65, marginBottom: 12 }}>
          Community NFT holders receive 5% of daily emission and MFP holders 1%. The MIC
          arrives on its own each day; paying it out is this button. The split is computed
          fresh from who currently holds an active NFT, because Community NFTs expire and a
          stored holder list would quietly go stale.
        </p>

        {pools?.error && <div style={{ fontSize: '0.66rem', color: 'var(--error)' }}>{pools.error}</div>}
        {pools?.data?.holderError && (
          <div style={{ fontSize: '0.64rem', color: 'var(--warning)', marginBottom: 10 }}>
            Holder read incomplete: {pools.data.holderError}
          </div>
        )}

        {pools?.data && (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
            {(['community', 'mfp'] as const).map((which) => {
              const pool = pools.data.pools[which];
              const rows = pools.data.plan
                ? (which === 'community' ? pools.data.plan.community : pools.data.plan.mfp)
                    .filter((r: any) => BigInt(r.amountWei) > 0n)
                : [];
              return (
                <div key={which} style={{
                  padding: '13px 15px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'rgba(255,255,255,.02)',
                }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--white)' }}>
                    {which === 'community' ? 'Community NFT — 5%' : 'MFP-NFT — 1%'}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-m)', fontSize: '1rem', fontWeight: 700,
                    color: Number(pool.balance) > 0 ? 'var(--success)' : 'var(--gray2)', margin: '6px 0',
                  }}>
                    {Number(pool.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} MIC
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--gray2)', lineHeight: 1.6 }}>
                    Paid out so far: {Number(pool.totalDistributed).toLocaleString(undefined, { maximumFractionDigits: 0 })} MIC
                    {' '}across {pool.distributionCount} batch{pool.distributionCount === 1 ? '' : 'es'}
                    <br />
                    <a href={`${CHAIN.explorerUrl}/address/${pool.address}`} target="_blank"
                       rel="noopener noreferrer" style={{ color: 'var(--gold)', textDecoration: 'none', fontFamily: 'var(--font-m)' }}>
                      {short(pool.address)} ↗
                    </a>
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--gray2)', marginTop: 8 }}>
                    {rows.length > 0
                      ? `${rows.length} wallet${rows.length === 1 ? '' : 's'} would be paid`
                      : 'No eligible holder'}
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    style={{ marginTop: 9 }}
                    disabled={busy === `dist-${which}` || rows.length === 0}
                    onClick={() => distribute(which)}
                  >
                    {busy === `dist-${which}` ? 'Distributing…' : 'Distribute'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {pools?.data?.note && (
          <div style={{ fontSize: '0.62rem', color: 'var(--gray2)', marginTop: 12, lineHeight: 1.65 }}>
            {pools.data.note}
          </div>
        )}
      </div>
    </div>
  );
}
