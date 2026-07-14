'use client'

import { useState } from 'react'
import { CONTRACTS } from '@/lib/contracts'

const BSC_TESTNET_HEX = '0x61'
const BSC_TESTNET_RPC = 'https://data-seed-prebsc-1-s1.binance.org:8545/'
const FAUCET_URL = 'https://testnet.bnbchain.org/faucet-smart'
const USDT_ABI_FAUCET = ['function faucet()', 'function mint(address to, uint256 amount)']

type Status = { type: 'idle' | 'success' | 'error' | 'pending'; msg?: string }

async function findInjectedProvider(): Promise<any> {
  if (typeof window === 'undefined') throw new Error('Not in browser')
  const w = window as any
  if (w.ethereum) return w.ethereum
  return new Promise((resolve, reject) => {
    let found: any = null
    const handler = (e: any) => { if (e.detail?.provider && !found) found = e.detail.provider }
    window.addEventListener('eip6963:announceProvider', handler)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', handler)
      if (found) resolve(found)
      else reject(new Error('No wallet detected — install MetaMask, Trust Wallet, or Bitget Wallet'))
    }, 600)
  })
}

export default function TestnetPage() {
  const [chainStatus, setChainStatus] = useState<Status>({ type: 'idle' })
  const [tokenStatus, setTokenStatus] = useState<Status>({ type: 'idle' })
  const [claimStatus, setClaimStatus] = useState<Status>({ type: 'idle' })

  const addBscTestnet = async () => {
    setChainStatus({ type: 'pending', msg: 'Open your wallet to confirm...' })
    try {
      const provider = await findInjectedProvider()
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BSC_TESTNET_HEX }] })
      } catch (e: any) {
        if (e.code === 4902) {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: BSC_TESTNET_HEX,
              chainName: 'BSC Testnet',
              nativeCurrency: { name: 'Test BNB', symbol: 'tBNB', decimals: 18 },
              rpcUrls: [BSC_TESTNET_RPC],
              blockExplorerUrls: ['https://testnet.bscscan.com'],
            }],
          })
        } else { throw e }
      }
      setChainStatus({ type: 'success', msg: '✓ BSC Testnet added/switched. Your wallet is now on testnet.' })
    } catch (e: any) {
      setChainStatus({ type: 'error', msg: e?.shortMessage || e?.message || 'Failed to add network' })
    }
  }

  const addUsdtToken = async () => {
    setTokenStatus({ type: 'pending', msg: 'Open your wallet to confirm...' })
    try {
      const provider = await findInjectedProvider()
      const wasAdded = await provider.request({
        method: 'wallet_watchAsset',
        params: {
          type: 'ERC20',
          options: {
            address: CONTRACTS.usdt,
            symbol: 'USDT',
            decimals: 6,
            image: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
          },
        },
      })
      if (wasAdded) setTokenStatus({ type: 'success', msg: '✓ USDT (Testnet) added to your wallet.' })
      else setTokenStatus({ type: 'error', msg: 'Token not added (cancelled).' })
    } catch (e: any) {
      setTokenStatus({ type: 'error', msg: e?.shortMessage || e?.message || 'Failed to add token' })
    }
  }

  const claimUsdt = async (amount: number) => {
    setClaimStatus({ type: 'pending', msg: `Claiming ${amount.toLocaleString()} USDT — confirm in wallet...` })
    try {
      const provider = await findInjectedProvider()
      await provider.request({ method: 'eth_requestAccounts' })

      // Ensure on BSC Testnet first
      const chainId = await provider.request({ method: 'eth_chainId' })
      if (chainId !== BSC_TESTNET_HEX) {
        throw new Error('Please switch to BSC Testnet first (Step 1 above)')
      }

      const { BrowserProvider, Contract, parseUnits } = await import('ethers')
      const browser = new BrowserProvider(provider)
      const signer = await browser.getSigner()
      const buyerAddress = await signer.getAddress()
      const usdt = new Contract(CONTRACTS.usdt, USDT_ABI_FAUCET as any, signer)

      // mint(to, amount) — amount with 6 decimals
      const tx = await usdt.mint(buyerAddress, parseUnits(amount.toString(), 6))
      setClaimStatus({ type: 'pending', msg: `Tx submitted: ${tx.hash.slice(0, 10)}... waiting confirmation...` })
      const receipt = await tx.wait()
      if (!receipt || receipt.status !== 1) throw new Error('Transaction reverted')

      setClaimStatus({
        type: 'success',
        msg: `✓ ${amount.toLocaleString()} USDT claimed to ${buyerAddress.slice(0, 6)}...${buyerAddress.slice(-4)}. Refresh your wallet to see balance.`,
      })
    } catch (e: any) {
      const code = e?.code
      const msg = e?.shortMessage || e?.message || 'Failed to claim'
      const isReject = code === 4001 || code === 'ACTION_REJECTED' || /reject|denied|user/i.test(msg)
      setClaimStatus({ type: 'error', msg: isReject ? 'Transaction cancelled.' : msg })
    }
  }

  return (
    <div className="testnet-page">
      <div className="testnet-hero">
        <div className="testnet-hero-badge">BSC TESTNET</div>
        <h1 className="testnet-hero-title">Get Started — Testing on Mission Chain</h1>
        <p className="testnet-hero-sub">
          Mission Chain runs on <strong>BSC Testnet</strong> (Chain ID 97) for development and testing.
          Follow the 4 steps below to set up your wallet and start exploring SEED, Pre-Sale, MICE, and NFT mechanics
          with free test tokens — no real money involved.
        </p>
      </div>

      {/* STEP 1 — Add BSC Testnet */}
      <section className="testnet-step">
        <div className="testnet-step-num">1</div>
        <div className="testnet-step-body">
          <h2 className="testnet-step-title">Add BSC Testnet network to your wallet</h2>
          <p className="testnet-step-desc">
            One click adds the <strong>BSC Testnet</strong> network to MetaMask, Trust Wallet, Bitget Wallet,
            or any EIP-1193 compatible wallet. Your wallet will switch to it automatically if it&apos;s already added.
          </p>
          <div className="testnet-info-grid">
            <div><span className="testnet-info-label">Network Name</span><span className="testnet-info-value">BSC Testnet</span></div>
            <div><span className="testnet-info-label">Chain ID</span><span className="testnet-info-value">97 (0x61)</span></div>
            <div><span className="testnet-info-label">Currency Symbol</span><span className="testnet-info-value">tBNB</span></div>
            <div><span className="testnet-info-label">RPC URL</span><span className="testnet-info-value mono-small">{BSC_TESTNET_RPC}</span></div>
            <div><span className="testnet-info-label">Explorer</span><span className="testnet-info-value">testnet.bscscan.com</span></div>
          </div>
          <button className="testnet-btn testnet-btn-primary" onClick={addBscTestnet}>
            ✦ Add BSC Testnet to Wallet
          </button>
          {chainStatus.type !== 'idle' && (
            <div className={`testnet-status testnet-status-${chainStatus.type}`}>{chainStatus.msg}</div>
          )}
        </div>
      </section>

      {/* STEP 2 — Get tBNB */}
      <section className="testnet-step">
        <div className="testnet-step-num">2</div>
        <div className="testnet-step-body">
          <h2 className="testnet-step-title">Get free tBNB for gas fees</h2>
          <p className="testnet-step-desc">
            You need a small amount of <strong>tBNB</strong> (Test BNB) to pay gas for any transaction on BSC Testnet.
            Use the official BNB Chain Faucet — free, no signup, ~0.5 tBNB per request, 24h cooldown.
          </p>
          <ol className="testnet-list">
            <li>Click the button below to open the faucet in a new tab.</li>
            <li>Copy your wallet address (from your wallet app).</li>
            <li>Paste address into the faucet form, complete the captcha, and click Give Me BNB.</li>
            <li>tBNB arrives in your wallet within ~30 seconds.</li>
          </ol>
          <a className="testnet-btn testnet-btn-secondary" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
            ↗ Open BNB Chain Faucet
          </a>
          <div className="testnet-tip">
            💡 <strong>Tip:</strong> 0.5 tBNB is plenty for ~50 transactions. If you run out, claim again after 24h or
            try alternate faucets like <a href="https://testnet.bnbchain.org/faucet-smart" target="_blank" rel="noopener noreferrer">BNB Chain</a>{' '}
            or <a href="https://faucets.chain.link/bnb-chain-testnet" target="_blank" rel="noopener noreferrer">Chainlink Faucet</a>.
          </div>
        </div>
      </section>

      {/* STEP 3 — Add USDT token */}
      <section className="testnet-step">
        <div className="testnet-step-num">3</div>
        <div className="testnet-step-body">
          <h2 className="testnet-step-title">Add USDT (Testnet) token to your wallet</h2>
          <p className="testnet-step-desc">
            Mission Chain uses a <strong>Mock USDT</strong> token on BSC Testnet — fully ERC-20 compatible with the
            same 6-decimal format as real USDT. One click adds it to your wallet so you can see the balance.
          </p>
          <div className="testnet-info-grid">
            <div><span className="testnet-info-label">Token Symbol</span><span className="testnet-info-value">USDT</span></div>
            <div><span className="testnet-info-label">Decimals</span><span className="testnet-info-value">6</span></div>
            <div className="testnet-info-full">
              <span className="testnet-info-label">Contract Address</span>
              <span className="testnet-info-value mono-small">{CONTRACTS.usdt}</span>
            </div>
          </div>
          <button className="testnet-btn testnet-btn-primary" onClick={addUsdtToken}>
            ✦ Add USDT (Testnet) to Wallet
          </button>
          {tokenStatus.type !== 'idle' && (
            <div className={`testnet-status testnet-status-${tokenStatus.type}`}>{tokenStatus.msg}</div>
          )}
        </div>
      </section>

      {/* STEP 4 — Claim USDT */}
      <section className="testnet-step">
        <div className="testnet-step-num">4</div>
        <div className="testnet-step-body">
          <h2 className="testnet-step-title">Claim free USDT (Testnet) — 1,000 to 10,000</h2>
          <p className="testnet-step-desc">
            Mint free <strong>Mock USDT</strong> directly to your wallet. Use it to test SEED packages
            ($1,000-$10,000), Pre-Sale ($25-$5,000), and MICE Licenses ($100-$500). Choose any amount —
            you can claim again whenever you need more.
          </p>
          <div className="testnet-claim-grid">
            <button className="testnet-claim-btn" onClick={() => claimUsdt(1000)} disabled={claimStatus.type === 'pending'}>
              <span className="testnet-claim-amount">1,000</span>
              <span className="testnet-claim-unit">USDT</span>
              <span className="testnet-claim-hint">Test Pre-Sale Builder</span>
            </button>
            <button className="testnet-claim-btn" onClick={() => claimUsdt(5000)} disabled={claimStatus.type === 'pending'}>
              <span className="testnet-claim-amount">5,000</span>
              <span className="testnet-claim-unit">USDT</span>
              <span className="testnet-claim-hint">Test SEED Founding Partner II</span>
            </button>
            <button className="testnet-claim-btn testnet-claim-btn-gold" onClick={() => claimUsdt(10000)} disabled={claimStatus.type === 'pending'}>
              <span className="testnet-claim-amount">10,000</span>
              <span className="testnet-claim-unit">USDT</span>
              <span className="testnet-claim-hint">Test SEED Founding Partner III</span>
            </button>
          </div>
          {claimStatus.type !== 'idle' && (
            <div className={`testnet-status testnet-status-${claimStatus.type}`}>{claimStatus.msg}</div>
          )}
          <div className="testnet-tip">
            ⚠️ Make sure Step 1 (network) and Step 2 (gas) are completed first — you need tBNB to pay gas for the claim transaction (~0.001 tBNB per claim).
          </div>
        </div>
      </section>

      {/* Next steps */}
      <section className="testnet-next">
        <h2 className="testnet-next-title">You&apos;re all set — what to test next?</h2>
        <div className="testnet-next-grid">
          <a href="/seed" className="testnet-next-card">
            <span className="testnet-next-icon">🌱</span>
            <span className="testnet-next-name">SEED Sale</span>
            <span className="testnet-next-desc">Buy $1K-$10K packages → get 1/3/8/20 MFP-NFTs + MIC vesting (6m cliff)</span>
          </a>
          <a href="/presale" className="testnet-next-card">
            <span className="testnet-next-icon">💰</span>
            <span className="testnet-next-name">Pre-Sale</span>
            <span className="testnet-next-desc">Buy from $25 → MIC at $0.005, F1/F2 referral rewards, Community NFT bonus</span>
          </a>
          <a href="/mice" className="testnet-next-card">
            <span className="testnet-next-icon">⛏️</span>
            <span className="testnet-next-name">MICE License</span>
            <span className="testnet-next-desc">Buy $100-$500 mining license → 50% USDT routed, 50% USDT swap-and-burn MIC</span>
          </a>
          <a href="/nft" className="testnet-next-card">
            <span className="testnet-next-icon">🎨</span>
            <span className="testnet-next-name">NFT Manager</span>
            <span className="testnet-next-desc">View granted MFP allowance, mint MFP-NFTs, see Community NFTs</span>
          </a>
        </div>
      </section>

      <style jsx global>{`
        /* Override globals.css body overflow:hidden so this standalone page can scroll */
        html, body {
          overflow-y: auto !important;
          overflow-x: hidden !important;
          height: auto !important;
          min-height: 100% !important;
        }
      `}</style>
      <style jsx>{`
        .testnet-page {
          max-width: 900px;
          margin: 0 auto;
          padding: 32px 20px 80px;
          color: var(--cream, #F5E8CC);
          min-height: 100vh;
        }
        .testnet-hero {
          text-align: center;
          margin-bottom: 40px;
        }
        .testnet-hero-badge {
          display: inline-block;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.2em;
          padding: 6px 14px;
          border-radius: 100px;
          background: rgba(212,160,23,0.15);
          color: #F5D56E;
          border: 1px solid rgba(212,160,23,0.4);
          margin-bottom: 16px;
        }
        .testnet-hero-title {
          font-size: clamp(1.5rem, 4vw, 2.4rem);
          font-weight: 700;
          color: #F5D56E;
          margin: 0 0 14px;
          line-height: 1.2;
        }
        .testnet-hero-sub {
          font-size: 0.95rem;
          line-height: 1.6;
          color: var(--gray, #B8A894);
          max-width: 700px;
          margin: 0 auto;
        }

        .testnet-step {
          display: flex;
          gap: 18px;
          padding: 24px;
          background: linear-gradient(155deg, rgba(38,20,58,0.55), rgba(22,14,35,0.65));
          border: 1px solid rgba(201,168,76,0.18);
          border-radius: 16px;
          margin-bottom: 20px;
        }
        .testnet-step-num {
          flex-shrink: 0;
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: linear-gradient(135deg, #C9A84C, #7B2D8B);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.4rem;
          font-weight: 800;
          font-family: var(--font-d, monospace);
        }
        .testnet-step-body { flex: 1; min-width: 0; }
        .testnet-step-title {
          font-size: 1.15rem;
          font-weight: 700;
          color: #F5D56E;
          margin: 0 0 8px;
        }
        .testnet-step-desc {
          font-size: 0.85rem;
          line-height: 1.6;
          color: var(--gray, #B8A894);
          margin: 0 0 14px;
        }

        .testnet-info-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 8px;
          padding: 12px;
          background: rgba(20,12,34,0.5);
          border: 1px solid rgba(201,168,76,0.12);
          border-radius: 10px;
          margin-bottom: 16px;
        }
        .testnet-info-grid > div {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 8px 10px;
        }
        .testnet-info-full { grid-column: 1 / -1; }
        .testnet-info-label {
          font-size: 0.62rem;
          color: var(--gray2, #888);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .testnet-info-value {
          font-size: 0.82rem;
          color: var(--cream, #F5E8CC);
          font-weight: 600;
        }
        .mono-small {
          font-family: monospace;
          font-size: 0.7rem;
          word-break: break-all;
        }

        .testnet-list {
          margin: 8px 0 16px 0;
          padding-left: 20px;
        }
        .testnet-list li {
          font-size: 0.85rem;
          line-height: 1.7;
          color: var(--gray, #B8A894);
        }

        .testnet-btn {
          display: inline-block;
          padding: 12px 22px;
          border-radius: 10px;
          font-size: 0.88rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          font-family: var(--font-d, sans-serif);
          cursor: pointer;
          transition: all 0.2s ease;
          text-decoration: none;
          border: none;
        }
        .testnet-btn-primary {
          background: linear-gradient(135deg, #C9A84C, #D4A017);
          color: #1A1208;
          box-shadow: 0 2px 8px rgba(201,168,76,0.25);
        }
        .testnet-btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 14px rgba(201,168,76,0.35);
        }
        .testnet-btn-secondary {
          background: transparent;
          color: #F5D56E;
          border: 1px solid rgba(212,160,23,0.5);
        }
        .testnet-btn-secondary:hover {
          background: rgba(212,160,23,0.10);
        }

        .testnet-claim-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px;
          margin-bottom: 14px;
        }
        .testnet-claim-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 22px 14px;
          background: rgba(40,26,58,0.5);
          border: 1px solid rgba(201,168,76,0.25);
          border-radius: 12px;
          cursor: pointer;
          color: var(--cream, #F5E8CC);
          transition: all 0.2s ease;
        }
        .testnet-claim-btn:hover:not(:disabled) {
          background: rgba(201,168,76,0.10);
          border-color: rgba(212,160,23,0.6);
          transform: translateY(-2px);
        }
        .testnet-claim-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .testnet-claim-btn-gold {
          background: linear-gradient(155deg, rgba(201,168,76,0.18), rgba(123,45,139,0.10));
          border-color: rgba(212,160,23,0.5);
        }
        .testnet-claim-amount {
          font-size: 1.6rem;
          font-weight: 800;
          font-family: var(--font-d, monospace);
          color: #F5D56E;
        }
        .testnet-claim-unit {
          font-size: 0.7rem;
          color: var(--gray, #B8A894);
          letter-spacing: 0.08em;
        }
        .testnet-claim-hint {
          font-size: 0.62rem;
          color: var(--gray2, #888);
          margin-top: 4px;
          text-align: center;
        }

        .testnet-status {
          margin-top: 12px;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 0.82rem;
          line-height: 1.5;
        }
        .testnet-status-pending {
          background: rgba(41,182,246,0.12);
          color: #29B6F6;
          border: 1px solid rgba(41,182,246,0.3);
        }
        .testnet-status-success {
          background: rgba(76,175,80,0.12);
          color: #66BB6A;
          border: 1px solid rgba(76,175,80,0.3);
        }
        .testnet-status-error {
          background: rgba(229,57,53,0.12);
          color: #FCA5A5;
          border: 1px solid rgba(229,57,53,0.3);
        }

        .testnet-tip {
          margin-top: 12px;
          padding: 10px 14px;
          font-size: 0.78rem;
          line-height: 1.6;
          color: var(--gray, #B8A894);
          background: rgba(201,168,76,0.05);
          border-left: 3px solid rgba(201,168,76,0.4);
          border-radius: 6px;
        }
        .testnet-tip a { color: #F5D56E; text-decoration: underline; }

        .testnet-next {
          margin-top: 36px;
          padding: 24px;
          background: linear-gradient(155deg, rgba(123,45,139,0.18), rgba(22,14,35,0.5));
          border: 1px solid rgba(123,45,139,0.3);
          border-radius: 16px;
        }
        .testnet-next-title {
          font-size: 1.2rem;
          font-weight: 700;
          color: #F5D56E;
          margin: 0 0 16px;
          text-align: center;
        }
        .testnet-next-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 12px;
        }
        .testnet-next-card {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 16px;
          background: rgba(20,12,34,0.55);
          border: 1px solid rgba(201,168,76,0.18);
          border-radius: 12px;
          text-decoration: none;
          color: var(--cream, #F5E8CC);
          transition: all 0.2s ease;
        }
        .testnet-next-card:hover {
          background: rgba(201,168,76,0.08);
          border-color: rgba(212,160,23,0.4);
          transform: translateY(-2px);
        }
        .testnet-next-icon { font-size: 1.6rem; }
        .testnet-next-name {
          font-size: 0.95rem;
          font-weight: 700;
          color: #F5D56E;
        }
        .testnet-next-desc {
          font-size: 0.72rem;
          line-height: 1.5;
          color: var(--gray, #B8A894);
        }

        /* Light mode */
        :global(body.light) .testnet-step {
          background: linear-gradient(155deg, #ffffff, #fdfcf9);
          border-color: rgba(154,123,46,0.18);
          box-shadow: 0 2px 12px rgba(0,0,0,0.04);
        }
        :global(body.light) .testnet-info-grid {
          background: rgba(248,245,240,0.8);
          border-color: rgba(154,123,46,0.15);
        }
        :global(body.light) .testnet-step-title { color: #8A6B17; }
        :global(body.light) .testnet-hero-title { color: #8A6B17; }
        :global(body.light) .testnet-step-desc,
        :global(body.light) .testnet-info-value,
        :global(body.light) .testnet-list li,
        :global(body.light) .testnet-tip,
        :global(body.light) .testnet-next-desc { color: #5A4E22; }
        :global(body.light) .testnet-info-value { color: #1A1208; }
        :global(body.light) .testnet-claim-btn {
          background: #ffffff;
          border-color: rgba(154,123,46,0.20);
          color: #1A1208;
        }
        :global(body.light) .testnet-claim-amount { color: #8A6B17; }
        :global(body.light) .testnet-next {
          background: linear-gradient(155deg, #ffffff, #fdfcf9);
          border-color: rgba(154,123,46,0.18);
        }
        :global(body.light) .testnet-next-card {
          background: #FAF6EE;
          border-color: rgba(154,123,46,0.18);
          color: #1A1208;
        }
        :global(body.light) .testnet-next-name,
        :global(body.light) .testnet-next-title { color: #8A6B17; }

        @media (max-width: 640px) {
          .testnet-step { flex-direction: column; padding: 18px; }
          .testnet-step-num { align-self: flex-start; }
          .testnet-claim-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}
