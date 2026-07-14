# MissionChain App — Claude Code Guide

## What This Repo Is

`missionchain_app` is the **Web3 DApp and Smart Contract monorepo** for MissionChain — a faith-based ecosystem on BSC. This repo contains ALL on-chain contracts, the user-facing DApp frontend, and the backend API.

**Read `PHASE1-BLUEPRINT.html` FIRST** — it contains the complete architecture, contract specifications, tokenomics, and deployment guide.

## Critical: Source of Truth

ALL tokenomics numbers MUST match the root `CLAUDE.md` in `Mission Chain Fullstack/`. If in doubt, check there.

## Monorepo Layout (Turborepo)

```
missionchain_app/
├── packages/
│   ├── contracts/          # Solidity — Hardhat
│   ├── sdk/                # Shared TypeScript SDK (ABIs, constants, types)
│   └── db/                 # Prisma schema + migrations
├── apps/
│   ├── web/                # Next.js 14 DApp frontend
│   └── api/                # Fastify backend API
└── docs/                   # Generated docs
```

## Smart Contracts — 24 Contracts

### Core Tokens & Sales (7)
1. **MICToken.sol** — BEP-20 + ERC20Capped(7B) + **ILockManager integration** (Hybrid Token-Level Lock). Override `_update()`: each transfer checks `amount <= balanceOf(from) - lockManager.lockedOf(from)`. Mint 15% at deploy, MINTER_ROLE for EmissionController
2. **LockManager.sol** — REWRITE (replaces VestingManager). Tracks vesting schedules per address. Does NOT hold tokens — tokens go directly to user wallets. `lockedOf()` is a view function (zero gas). Supports multiple schedules per address.
3. **SeedSale.sol** — SEED round ($0.0025/MIC, KYC whitelist, NO referral)
4. **ReferralRegistry.sol** — F1: 7% USDT / F2: 3% USDT
5. **PreSale.sol** — Pre-sale ($0.005/MIC, min $25, NFT bonus per package, HAS referral)
6. **AirdropDistributor.sol** — Merkle proof claims
7. **MICELicense.sol** — ERC-1155, 100K max, 5-round fixed pricing $100-$500 (20K/round), 50% MIC burned + 50% USDT, 360 days

### Mining & Staking (3)
8. **EmissionController.sol** — E(t) = E_base × D(t) × R(t) × W(t), 180-day half-life, WarmUp 30d
9. **MiningPool.sol** — Hindex-weighted distribution to MICE holders
10. **MICStaking.sol** — Pure MIC staking with 4 time-lock periods, no NFT involvement

### NFTs (3)
11. **MFPNFT.sol** — ERC-721, 25K + 25K (DAO vote), ×10 multiplier, lifetime
12. **CommunityNFT.sol** — ERC-1155, Builder/Maker/Luminary, durations 60/90/180d
13. **MockUSDT.sol** — Test token (testnet only)

### Revenue Routing (2)
14. **RevenueRouter.sol** — NEW — Central revenue splitter (both MICE & PreSale: 35/7.5/12.5+5/40)
15. **SeedBudget.sol** — NEW — SEED 50/50 split (Operational + Net Capital) + Agent KPI

### Reward System — 5 Contracts (split from former RewardPool.sol)
16. **RewardDistributor.sol** — NEW — Splitter: receives from RevenueRouter, routes to 4 sub-contracts
17. **ClaimRewards.sol** — NEW — Layers 1-3: Referral Reserve 10% + Community Builder 5% + GV Bonus 9%
18. **PeriodicRewards.sol** — NEW — Layer 4: Monthly NFT Pool 7.5%
19. **LuckyDraw.sol** — NEW — Weekly Lucky Draw 1%, Chainlink VRF, isolated risk
20. **IncentivePool.sol** — NEW — DAO-governed incentives (2.5% both PreSale & MICE)

### Infrastructure (3)
21. **ManagementPool.sol** — NEW — Leadership auto-accumulate, self-claim
22. **LiquidityPool.sol** — NEW — Phase 1: Buffer only (holds 105M locked MIC from deploy); Phase 2 (deferred): + SWAP + AI Stabilizer
23. **TreasuryManager.sol** — MODIFY — Receive 12.5% from Router, pool management

### Governance (1)
24. **DAOGovernor.sol** — NEW — On-chain DAO governance replacing Gnosis Safe. Ban Thường Trực 3/5 + ≥75% MFP staked weight. Timelocks: 24h params/budget, 7d structural, 0 emergency.

## ⚠ NEVER

- Commit `.env` or any file with private keys / API keys
- Change tokenomics numbers without updating ALL files (root CLAUDE.md, all appendices, translations)
- Deploy to mainnet without passing 100% test coverage + audit
- Grant MINTER_ROLE to anyone other than EmissionController (85% only minted progressively)
- Pre-mint the 85% mining pool (it must be minted on-demand by EmissionController via mintFromMining)
- Add referral logic to SeedSale (SEED has NO referral — Pre-Sale ONLY)
- Skip ReentrancyGuard on any contract with external calls
- Use spot price for BNB conversion (must use TWAP oracle)
- Use old VestingManager pattern (tokens held in contract, user claims) — replaced by Hybrid Token-Level Lock (tokens in user wallet, locked via LockManager)

## ✅ ALWAYS

- Run `npx hardhat test` before committing
- Handle USDT (6 decimals) vs MIC (18 decimals) conversions carefully
- Use OpenZeppelin's SafeERC20 for all token transfers
- Use AccessControl (not Ownable) for role-based permissions
- Grant DEFAULT_ADMIN_ROLE to DAOGovernor, not deployer
- Include NatSpec comments on all public functions
- Emit events for all state changes (Event Indexer depends on this)
- Use ERC20Capped to enforce 7B hard cap at Solidity level
- Only mint 15% (1.05B) in constructor; 85% minted progressively by EmissionController
- EmissionController.distributeDaily() must check activeMICE > 0 before minting

## Token Supply Architecture

```
HARD CAP: 7,000,000,000 MIC (enforced by ERC20Capped)

AT DEPLOY (constructor):
  15% = 1,050,000,000 MIC → minted DIRECTLY:
  Sale Contracts(945M) = Seed(227.5M) + PreSale(315M) + Founders(280M) + Community(105M) + Airdrops(17.5M)
    → Tokens sent directly to buyer wallets at purchase, locked via LockManager (Hybrid Token-Level Lock)
    → User sees full balance on MetaMask/BSCScan. Locked tokens auto-unlock per vesting schedule. No claim needed.
  LiquidityPool(105M) = DEX/CEX Listing — locked in contract, cannot withdraw (CEX via DAOGovernor only)

RUNTIME (progressive mining):
  85% = 5,950,000,000 MIC → NOT pre-minted
  EmissionController has MINTER_ROLE → calls micToken.mintFromMining()
  Only mints when activeMICE > 0 (no miners = no new tokens)
```

## Key Formulas

### Emission (triggers mintFromMining)
```
E(t) = E_base(t) × D(t) × R(t) × W(t)
E_base(t) = E₀ × e^(−λt)    // E₀ = 22,907,500 MIC/day, T_half = 180 days
D(t) = 0.5 + U(t)            // U = activeMICE / 100,000
R(t) = clamp(250%/ROI, 0.5, 2.0)
W(t) = min(1.0, t / 30)      // WarmUp factor (first 30 days)
CRITICAL: if activeMICE == 0 → E(t) = 0 (no emission)
```

### MICE Licensing — 5-Round Fixed Pricing
```
Round 1 (0–20K licenses):        $100 per MICE
Round 2 (20K–40K licenses):      $200 per MICE
Round 3 (40K–60K licenses):      $300 per MICE
Round 4 (60K–80K licenses):      $400 per MICE
Round 5 (80K–100K licenses):     $500 per MICE

Payment split per MICE:
  50% MIC (burned to reduce supply)
  50% USDT (sent to RevenueRouter)
    → 35% Marketing & Sales (Referral 10%, Community Builder 5%, Lucky Draw 1%, Monthly NFT 7.5%, GV Bonus 9%, Incentives 2.5%)
    → 7.5% Management & Operational (Founder 1.5%, Architect 1%, CTO 0.5%, Social Media 0.5%, Global Training 0.5%, Tech Team 1%, Bonus 2.5%)
    → 12.5% DAO Treasury (World Dev 2.5% + App 5% + Reserved 5%)
    → 5% Reserved Staking
    → 40% Liquidity Pool & Buffer
```

### Vesting — Hybrid Token-Level Lock (via LockManager.sol)
```
SEED/Pre-Sale: Cliff 6 months → 10% unlock → 2.5%/month → 100% at month 42
Founders/Mgmt: Cliff 24 months → 10% unlock → 2.5%/month → 100% at month 60
Community: Cliff 24 months → 10% unlock → 2.5%/month → 100% at month 60

Token goes DIRECTLY to user wallet (visible on BSCScan/MetaMask).
LockManager tracks lock amount — user cannot transfer locked tokens.
No claim needed — unlock is automatic based on block.timestamp.
```

### Pre-Sale Packages (@ $0.005/MIC, NFT bonus per package)
```
Minimum:           $25+    → 5,000+ MIC (no NFT bonus)
Package Builder:   $1,000  → 200,000 MIC   + Builder NFT (60d)
Package Maker:     $2,500  → 500,000 MIC   + Maker NFT (90d)
Package Luminary:  $5,000  → 1,000,000 MIC + Luminary NFT (180d)

HARD_CAP = $1,575,000. ALLOCATION = 315,000,000 MIC.
No MIC bonus. NFT bonus = CommunityNFT minted at purchase.
```

### NFT Architecture — 2 Types

**Type 1: Community NFTs** (unlimited supply, time-limited, NO DAO voting)
```
Builder (formerly Silver):    Duration 60d,   Multiplier ×1.0,   Staking cap 10,000 MIC/NFT
Maker (formerly Gold):        Duration 90d,   Multiplier ×2.5,   Staking cap 25,000 MIC/NFT
Luminary (formerly Platinum): Duration 180d,  Multiplier ×5.0,   Staking cap 50,000 MIC/NFT
```

**Type 2: MFP — Mission Founders Pass** (25K max +25K by DAO, lifetime, DAO voting)
```
MFP:        Lifetime,       Multiplier ×10.0,  Staking cap 100,000 MIC/NFT
            Full DAO governance & voting rights when staked at Full Cap + lock ≥360d
            Max supply: 25,000
```

**MIC Staking Time-Locks:**
- 30d: ×1.0
- 90d: ×1.25
- 180d: ×1.5
- 360d: ×2.0
- No staking caps — stake any amount

**DAO participation:** MFP-NFT only. Requires Full Cap staking (100,000 MIC/NFT) + lock ≥360 days remaining.

## Locked MIC Staking

Vesting-locked MIC (tracked via LockManager) **can participate in staking**:
- **Full Multiplier**: Locked MIC earns at the same time-lock multiplier as unlocked MIC (no penalty)
- **Rewards Unlocked**: Staking rewards are immediately transferable (not subject to vesting)
- **Minimum 360-Day Staking Lock**: Locked MIC must be staked for 360 days minimum (achieves ×2.0 time-lock multiplier)
- **No Staking Caps**: Pure MIC staking allows unlimited per-address staking
- **DAO Voting**: Only unlocked MIC counts toward voting weight

**Implementation — Option B (Wallet-Resident Staking)**:
MIC stays in the holder's wallet when staked — it is NOT transferred to the staking contract.
MICStaking.sol is added to MICToken's `approvedStakingContracts` list. The token's `_update()` checks:
`amount <= balanceOf(from) - lockManager.lockedOf(from) - stakingManager.stakedOf(from)`

This means:
- **MetaMask/BSCScan shows full balance** = Available + Vesting + Staked (all on wallet)
- **Available** = can freely transfer/sell
- **Vesting** = locked by LockManager, auto-unlocks per schedule
- **Staked** = locked by MICStaking, earns rewards, cannot transfer until unstaked
- User sees ONE token (MIC) in their wallet with the total balance
- DApp dashboard shows the 3-state breakdown (Available / Vesting / Staked)

## Circuit Breakers
1. Cumulative: totalEmitted ≤ 5,950,000,000
2. Daily: E(t) ≤ 2 × E_base(t)
3. Price floor: $0.001 MIC → pause
4. Unstake: max 10%/day
5. Emergency: DAOGovernor (Ban Thường Trực 3/5 + ≥75% MFP weight, no timelock)

## Testing Commands

```bash
cd packages/contracts
npx hardhat compile              # Compile
npx hardhat test                 # Unit + integration tests
npx hardhat coverage             # Coverage report (target: 100%)
npx hardhat run scripts/deploy-testnet.ts --network bscTestnet
```

## Environment Variables (.env.example)

```
DEPLOYER_PK=0x...
GNOSIS_SAFE_ADDRESS=0x...
USDT_ADDRESS=0x55d398326f99059fF775485246999027B3197955
BSCSCAN_API_KEY=...
DATABASE_URL=postgresql://...
JWT_SECRET=...
NEXT_PUBLIC_WC_PROJECT_ID=...
```

## Relationship to Other Repos

| Repo | Purpose | Sync |
|------|---------|------|
| `missionchain_info` | Public website → **missionchain.io** (8 languages, temporary) | Documents reference tokenomics from here |
| `missionchain_world` | Community platform → **missionchain.world** (SOPHIA, challenges) | Shares User table via shared DB |
| `missionchain_app` ← | **THIS REPO** — Web3 DApp → **missionchain.io** + Smart Contracts | Source of truth for on-chain logic |
| Admin Dashboard | Unified admin → **admin.missionchain.io** | Manages all 3 apps via RBAC |
