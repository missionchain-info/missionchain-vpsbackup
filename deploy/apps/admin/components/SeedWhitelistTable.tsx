'use client';

import { useCallback, useEffect, useState } from 'react';
import { getActiveChain } from '@missionchain/sdk';
import { fetchSeedWhitelist } from '@/lib/api';

/**
 * The wallets currently cleared to buy the SEED round, and what each has bought.
 *
 * `SeedSaleV9` stores the list as a `mapping(address => bool)`, which cannot be read back
 * as a list, so this comes from the API — it replays `WhitelistUpdated` to rebuild the
 * membership and `SeedPurchase` to total each wallet's MIC. That work has to happen
 * server-side: the public BSC endpoints refuse `eth_getLogs`, and the archive key that
 * can answer it must not be shipped to a browser.
 *
 * Everything shown is derived from chain events, so a wallet added or removed from the
 * panel above appears here on the next refresh with no database in between.
 */

const CHAIN = getActiveChain();
const PAGE_SIZE = 10;

type Row = {
  address: string;
  addedAtBlock: number;
  micPurchased: number;
  usdtPaid: number;
  orders: number;
};

type Payload = {
  rows: Row[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  totalMicPurchased: number;
  contract: string;
};

const short = (a: string) => `${a.slice(0, 10)}…${a.slice(-8)}`;
const num = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: n < 1 && n > 0 ? 4 : 0 });

export default function SeedWhitelistTable({ reloadKey = 0 }: { reloadKey?: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await fetchSeedWhitelist({ page, pageSize: PAGE_SIZE, search: applied || undefined });
      setData(body.data as Payload);
    } catch (e: any) {
      setError(e?.message || 'Could not load the whitelist');
      setData(null);
    }
    setLoading(false);
  }, [page, applied]);

  useEffect(() => { load(); }, [load, reloadKey]);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setApplied(search.trim());
  };

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--white)' }}>
          Cleared wallets
        </div>
        {data && (
          <span style={{ fontSize: '0.6rem', color: 'var(--gray2)' }}>
            {data.total} total{data.totalMicPurchased > 0 && ` · ${num(data.totalMicPurchased)} MIC bought`}
          </span>
        )}
        <button
          className="btn btn-outline btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={load}
          disabled={loading}
        >
          ↻ Refresh
        </button>
      </div>

      <form onSubmit={submitSearch} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by address…"
          style={{ flex: 1, fontFamily: 'var(--font-m)', fontSize: '0.66rem' }}
        />
        <button className="btn btn-outline btn-sm" type="submit" disabled={loading}>Search</button>
        {applied && (
          <button
            className="btn btn-outline btn-sm"
            type="button"
            onClick={() => { setSearch(''); setApplied(''); setPage(1); }}
          >
            Clear
          </button>
        )}
      </form>

      {error && (
        <div style={{
          fontSize: '0.66rem', padding: '9px 11px', borderRadius: 5, marginBottom: 10,
          color: 'var(--error)', background: 'rgba(242,109,139,.1)',
        }}>{error}</div>
      )}

      {loading && !data && (
        <div style={{ fontSize: '0.66rem', color: 'var(--gray2)', padding: '10px 0' }}>Loading…</div>
      )}

      {data && data.rows.length === 0 && !loading && (
        <div style={{ fontSize: '0.66rem', color: 'var(--gray2)', padding: '12px 0', lineHeight: 1.7 }}>
          {applied
            ? 'No cleared wallet matches that address.'
            : 'No wallets are cleared yet. Until one is added, nobody can buy the SEED round — which is the intended state while the Pre-Sale is running.'}
        </div>
      )}

      {data && data.rows.length > 0 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.64rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--gray2)' }}>
                  <th style={{ padding: '6px 8px', fontWeight: 600 }}>Wallet</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>MIC purchased</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>USDT paid</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Orders</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Cleared at block</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.address} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '7px 8px', fontFamily: 'var(--font-m)' }}>
                      <a
                        href={`${CHAIN.explorerUrl}/address/${r.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={r.address}
                        style={{ color: 'var(--gold)', textDecoration: 'none' }}
                      >
                        {short(r.address)} ↗
                      </a>
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-m)',
                                 color: r.micPurchased > 0 ? 'var(--success)' : 'var(--gray2)' }}>
                      {r.micPurchased > 0 ? num(r.micPurchased) : '—'}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-m)', color: 'var(--gray2)' }}>
                      {r.usdtPaid > 0 ? `$${num(r.usdtPaid)}` : '—'}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', color: 'var(--gray2)' }}>
                      {r.orders || '—'}
                    </td>
                    <td style={{ padding: '7px 8px', textAlign: 'right', fontFamily: 'var(--font-m)', color: 'var(--gray2)' }}>
                      {r.addedAtBlock.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <button
                className="btn btn-outline btn-sm"
                disabled={loading || data.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <span style={{ fontSize: '0.62rem', color: 'var(--gray2)' }}>
                Page {data.page} of {data.totalPages}
              </span>
              <button
                className="btn btn-outline btn-sm"
                disabled={loading || data.page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      <p style={{ fontSize: '0.56rem', color: 'var(--gray2)', marginTop: 10, lineHeight: 1.6 }}>
        Rebuilt from on-chain <code>WhitelistUpdated</code> and <code>SeedPurchase</code> events —
        there is no database copy to fall out of step with the contract.
      </p>
    </div>
  );
}
