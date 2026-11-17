# MissionChain — Full System Architecture
## Contracts + Frontend + Admin + DB Flow
### Updated: 2026-04-06 — Based on MIC Contracts Scheme.xlsx + Red Notes

---

## I. SMART CONTRACTS — FULL LIST (16 Contracts)

### EXISTING (13 contracts — need updates per red notes)

| # | Contract | Type | Status |
|---|----------|------|--------|
| 1 | MICToken.sol | BEP-20 + ERC20Capped + Pausable + ILockManager integration | ✅ Done |
| 2 | LockManager.sol | Hybrid token-level lock (replaces VestingManager) | ✅ Done |
| 3 | SeedSale.sol | SEED round + MFP-NFT bundle | ✅ Done |
| 4 | ReferralRegistry.sol | F1/F2 referral | ⚠ Need: adjustable F1/F2 % |
| 5 | PreSale.sol | Pre-sale + referral | ⚠ Need: adjustable bonus % per package |
| 6 | AirdropDistributor.sol | Merkle proof claims | ✅ Done |
| 7 | MICELicense.sol | ERC-1155 mining license | ⚠ Need: adjustable price step |
| 8 | EmissionController.sol | Adaptive emission engine | ⚠ Need: adjustable split % |
| 9 | MiningPool.sol | Hindex-weighted rewards | ✅ Done |
| 10 | NFTStaking.sol | Tier×Lock staking | ✅ Done (updated Builder/Maker/Luminary) |
| 11 | MFPNFT.sol | ERC-721 Founding Partner | ✅ Done |
| 12 | CommunityNFT.sol | ERC-1155 Builder/Maker/Luminary | ⚠ Need: adjustable multipliers |
| 13 | MockUSDT.sol | Test only | ✅ Done |

### NEW CONTRACTS TO ADD (3 contracts)

| # | Contract | Type | Purpose |
|---|----------|------|---------|
| 14 | **TreasuryManager.sol** | Fund management | Central treasury, fund allocation between pools |
| 15 | **LiquidityManager.sol** | Liquidity pool | MIC/USDT liquidity on PancakeSwap |
| 16 | **BuybackBurn.sol** | Buyback & burn | Automated buyback MIC + burn |

---

## II. CONTRACT UPDATES REQUIRED (Red Notes)

### A. ReferralRegistry.sol — Adjustable F1/F2 Rates

```
CURRENT:  F1_BPS = 700 (7%), F2_BPS = 300 (3%) — HARDCODED constants
REQUIRED: F1_BPS and F2_BPS as state variables, adjustable by ADMIN

NEW FUNCTIONS:
  setF1Rate(uint256 newBps) → onlyRole(DEFAULT_ADMIN_ROLE)
    require(newBps >= 100 && newBps <= 1000, "1%-10%")

  setF2Rate(uint256 newBps) → onlyRole(DEFAULT_ADMIN_ROLE)
    require(newBps >= 100 && newBps <= 1000, "1%-10%")

EVENTS:
  F1RateUpdated(uint256 oldRate, uint256 newRate)
  F2RateUpdated(uint256 oldRate, uint256 newRate)
```

### B. PreSale.sol — REWRITE (per Final Specs Apr 7, 2026)

```
PACKAGES (NO MIC BONUS — NFT bonus instead):
  Minimum:           $25+    → 5,000+ MIC (no NFT)
  Package Builder:   $1,000  → 200,000 MIC   + CommunityNFT Builder (60d)
  Package Maker:     $2,500  → 500,000 MIC   + CommunityNFT Maker (90d)
  Package Luminary:  $5,000  → 1,000,000 MIC + CommunityNFT Luminary (180d)

  Rate: $0.005/MIC. HARD_CAP = $1,575,000. ALLOCATION = 315M MIC.

STATE:
  struct Package {
    uint256 usdtCost;
    uint256 micAmount;
    uint8 nftTier;       // 0=none, 1=Builder, 2=Maker, 3=Luminary
    bool active;
  }
  Package[] public packages;
  uint256 public MIN_PURCHASE = 25e6; // $25 USDT minimum

FLOW:
  USDT in → ReferralRegistry (F1:7% + F2:3%) → RevenueRouter (90% net)
  MIC → Transferred directly to buyer wallet → LockManager.createSchedule() tracks lock (6mo cliff → 10% → 2.5%/mo). No claim needed, tokens auto-unlock.
  NFT → CommunityNFT.mint(buyer, tier) if package purchased

EVENTS:
  PreSalePurchase(address buyer, uint256 packageIndex, uint256 usdt, uint256 mic, uint8 nftTier)
```

### C. MICELicense.sol — Adjustable Price Step

```
CURRENT:  BASE_PRICE = 300e6, PRICE_RANGE = 700e6 — HARDCODED constants
REQUIRED: basePrice and priceRange as state variables, adjustable by ADMIN

NEW FUNCTIONS:
  setPricing(uint256 newBase, uint256 newRange) → ADMIN
    require(newBase >= 100e6 && newBase <= 500e6, "$100-$500")
    require(newRange >= 200e6 && newRange <= 1500e6, "$200-$1500")

EVENTS:
  PricingUpdated(uint256 oldBase, uint256 newBase, uint256 oldRange, uint256 newRange)
```

### D. EmissionController.sol — Adjustable Split Percentages

```
CURRENT:  MINERS_BPS=6000, STAKING_BPS=2000, DAO_BPS=1500, BURN_BPS=500 — HARDCODED
REQUIRED: State variables, adjustable by ADMIN within ±10% of original

NEW STATE:
  uint256 public minersBps = 6000;
  uint256 public stakingBps = 2000;
  uint256 public daoBps = 1500;
  uint256 public burnBps = 500;

  // Original values for ±10% constraint
  uint256 constant ORIG_MINERS = 6000;
  uint256 constant ORIG_STAKING = 2000;
  uint256 constant ORIG_DAO = 1500;
  uint256 constant ORIG_BURN = 500;

NEW FUNCTIONS:
  setSplitRatios(uint256 miners, uint256 staking, uint256 dao, uint256 burn) → ADMIN
    require(miners + staking + dao + burn == 10000, "must = 100%")
    require(miners >= ORIG_MINERS - 1000 && miners <= ORIG_MINERS + 1000, "±10%")
    require(staking >= ORIG_STAKING - 1000 && staking <= ORIG_STAKING + 1000, "±10%")
    require(dao >= ORIG_DAO - 1000 && dao <= ORIG_DAO + 1000, "±10%")
    require(burn >= ORIG_BURN - 1000 && burn <= ORIG_BURN + 1000, "±10%")

EVENTS:
  SplitRatiosUpdated(uint256 miners, uint256 staking, uint256 dao, uint256 burn)
```

### E. CommunityNFT.sol — Adjustable Multipliers

```
CURRENT:  MULT_BUILDER=10000, MULT_MAKER=25000, MULT_LUMINARY=50000 — HARDCODED
REQUIRED: State variables, adjustable by ADMIN

NEW STATE:
  uint256 public multBuilder = 10000;
  uint256 public multMaker = 25000;
  uint256 public multLuminary = 50000;

NEW FUNCTIONS:
  setMultipliers(uint256 builder, uint256 maker, uint256 luminary) → ADMIN
    require(builder >= 5000 && builder <= 20000, "×0.5 to ×2")
    require(maker >= 10000 && maker <= 50000, "×1 to ×5")
    require(luminary >= 20000 && luminary <= 100000, "×2 to ×10")
    require(builder < maker && maker < luminary, "must be ascending")

EVENTS:
  MultipliersUpdated(uint256 builder, uint256 maker, uint256 luminary)
```

---

## III. NEW CONTRACTS SPECIFICATION

### 14. TreasuryManager.sol — "Kho bạc trung ương"

```
PURPOSE:
  Central management of all MissionChain funds.
  Controls fund transfers between pools with governance constraints.

CONSTRAINTS (from red notes):
  - Max ±5% per transfer
  - Max 2 transfers per month per pool
  - DAOGovernor approval required

STATE VARIABLES:
  IERC20 public usdt;
  IERC20 public micToken;

  // Sub-treasury pools
  address public seedPool;        // SEED Round funds
  address public presalePool;     // Pre-Sale funds
  address public airdropPool;     // Airdrop reserve
  address public foundersPool;    // Founders & Mgmt
  address public churchesPool;    // Churches/Community fund
  address public daoReserve;      // DAO Treasury reserve
  address public operationsPool;  // Operating expenses

  // Governance constraints
  uint256 constant MAX_TRANSFER_BPS = 500;   // 5% max per transfer
  uint256 constant MAX_TRANSFERS_PER_MONTH = 2;

  mapping(bytes32 => uint256) public monthlyTransferCount;
  // key = keccak256(poolAddress, year, month)

  // Tracking
  uint256 public totalUSDTReceived;
  uint256 public totalMICManaged;

FUNCTIONS:
  // Fund transfer between pools
  transferBetweenPools(
    address fromPool,
    address toPool,
    address token,     // USDT or MIC
    uint256 amount
  ) → onlyRole(DEFAULT_ADMIN_ROLE)  // DAOGovernor
    → require: amount <= poolBalance * MAX_TRANSFER_BPS / 10000
    → require: monthlyTransferCount < MAX_TRANSFERS_PER_MONTH
    → emit FundTransfer(from, to, token, amount, timestamp)

  // Burn unsold tokens from completed rounds
  burnUnsoldTokens(address saleContract) → ADMIN
    → check if sale round ended
    → transfer remaining MIC to 0xdEaD
    → emit TokensBurned(saleContract, amount)

  // Views
  getPoolBalance(address pool, address token) → view
  getMonthlyTransferCount(address pool) → view
  getAllPoolBalances() → view (returns struct[])

EVENTS:
  FundTransfer(address indexed from, address indexed to, address token, uint256 amount, uint256 timestamp)
  TokensBurned(address indexed saleContract, uint256 amount)
  PoolAdded(address indexed pool, string name)
  PoolRemoved(address indexed pool)

ROLES:
  DEFAULT_ADMIN_ROLE → DAOGovernor 3-of-5
```

### 15. LiquidityManager.sol — "Quản lý thanh khoản"

```
PURPOSE:
  Manages MIC/USDT liquidity on PancakeSwap V3.
  Receives 30% of MICE license revenue.

STATE VARIABLES:
  IERC20 public usdt;
  IERC20 public micToken;
  IPancakeRouter public router;
  address public pair;          // MIC/USDT LP pair

  uint256 public totalLiquidityAdded;
  uint256 public totalLPTokens;

  // Auto-add liquidity threshold
  uint256 public autoAddThreshold = 1000e6;  // $1,000 USDT triggers auto-add
  bool public autoAddEnabled = true;

FUNCTIONS:
  // Add liquidity (called manually or auto-triggered)
  addLiquidity(uint256 usdtAmount, uint256 micAmount, uint256 slippageBps) → ADMIN
    → approve router
    → router.addLiquidity(MIC, USDT, amounts, slippage)
    → emit LiquidityAdded(usdtAmount, micAmount, lpReceived)

  // Remove liquidity (emergency only)
  removeLiquidity(uint256 lpAmount, uint256 minUsdt, uint256 minMic) → ADMIN
    → require: emergency flag or governance approval
    → router.removeLiquidity(...)
    → emit LiquidityRemoved(lpAmount, usdtReceived, micReceived)

  // Receive USDT from MICE purchases (called by MICELicense)
  receiveFunds() → external
    → if balance >= autoAddThreshold && autoAddEnabled
    → auto-pair with equivalent MIC from treasury
    → addLiquidity(...)

  // Views
  getCurrentLiquidity() → view (USDT + MIC amounts in pool)
  getLPBalance() → view
  getPrice() → view (MIC/USDT from pool)

EVENTS:
  LiquidityAdded(uint256 usdt, uint256 mic, uint256 lpTokens)
  LiquidityRemoved(uint256 lpTokens, uint256 usdt, uint256 mic)
  FundsReceived(address indexed from, uint256 usdtAmount)
  AutoAddTriggered(uint256 usdt, uint256 mic)

ROLES:
  DEFAULT_ADMIN_ROLE → DAOGovernor
  OPERATOR_ROLE → Backend keeper (auto-add)
```

### 16. BuybackBurn.sol — "Mua lại & đốt"

```
PURPOSE:
  Receives 20% of MICE license revenue + 5% of daily emission.
  Buys MIC from market (PancakeSwap) and burns to 0xdEaD.

STATE VARIABLES:
  IERC20 public usdt;
  IERC20 public micToken;
  IPancakeRouter public router;

  uint256 public totalBurned;         // Total MIC burned
  uint256 public totalUSDTSpent;      // Total USDT used for buyback

  // Auto-buyback settings
  uint256 public buybackThreshold = 500e6;  // $500 USDT triggers buyback
  uint256 public maxSlippageBps = 300;      // 3% max slippage
  bool public autoBuybackEnabled = true;

FUNCTIONS:
  // Execute buyback & burn
  executeBuyback(uint256 usdtAmount) → OPERATOR_ROLE
    → router.swapExactTokensForTokens(USDT → MIC)
    → micToken.transfer(0x000...dEaD, micReceived)
    → emit BuybackExecuted(usdtSpent, micBurned)

  // Burn MIC directly (from emission 5%)
  burnDirect(uint256 micAmount) → external
    → receive MIC from EmissionController
    → transfer to 0xdEaD
    → emit DirectBurn(micAmount)

  // Auto-execute when threshold reached
  checkAndExecute() → external (anyone, keeper-friendly)
    → if usdtBalance >= buybackThreshold → executeBuyback

  // Views
  getTotalBurned() → view
  getPendingBuyback() → view (USDT balance waiting)

EVENTS:
  BuybackExecuted(uint256 usdtSpent, uint256 micBurned, uint256 timestamp)
  DirectBurn(uint256 micBurned)
  ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold)

ROLES:
  DEFAULT_ADMIN_ROLE → DAOGovernor
  OPERATOR_ROLE → Backend keeper
```

---

## IV. NFT CONTRACTS SUMMARY (4 Types in 3 Contracts)

| NFT Type | Contract | Standard | Multiplier | Duration | Cap | Issued When |
|----------|----------|----------|-----------|----------|-----|-------------|
| **MFP-NFT** | MFPNFT.sol | ERC-721 | ×10 | Permanent | 25,000 (+25K DAO) | SEED package bundle |
| **Builder** | CommunityNFT.sol | ERC-1155 (id=1) | ×1 | 60 days → expired | Unlimited | Community activity |
| **Maker** | CommunityNFT.sol | ERC-1155 (id=2) | ×2.5 | 90 days → expired | Unlimited | Community activity |
| **Luminary** | CommunityNFT.sol | ERC-1155 (id=3) | ×5 | 180 days → expired | Unlimited | Community activity |

**Plus:** MICELicense.sol (ERC-1155) = Mining License, 360 days, 100K max — separate from NFT staking tier

### NFT → Staking Tier Mapping:

```
MFPNFT.isHolder(user) == true       → Tier.MFP (×10, cap 100K MIC)
CommunityNFT.highestActiveTier(user):
  3 (Luminary)                       → Tier.Luminary (×5, cap 50K)
  2 (Maker)                          → Tier.Maker (×2.5, cap 25K)
  1 (Builder)                        → Tier.Builder (×1, cap 10K)
  0 (None)                           → Tier.NoNFT (×0.5, Unlimited)

Priority: MFP > Luminary > Maker > Builder > NoNFT
Oracle checks MFPNFT first, then CommunityNFT → setUserTier()
```

---

## V. COMPLETE SYSTEM FLOW — Frontend + Admin + DB + Smart Contract

### A. FRONTEND (missionchain.io) — User-Facing Pages

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FRONTEND — missionchain.io                       │
│                    Next.js 14 CSR + wagmi                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  /                  Dashboard (Portfolio Overview)                   │
│  /seed              SEED Round Purchase                              │
│  /presale           Pre-Sale Purchase + Referral                     │
│  /vesting           Lock Schedule (Token-Level, auto-unlock)         │
│  /mice              MICE License Purchase + Renew                    │
│  /mining            Mining Pool Dashboard + Claim                    │
│  /nft               NFT Portfolio (MFP + Community + MICE)           │
│  /staking           MIC Staking (Stake/Unstake/Claim)                │  ← Pure MIC staking
│  /network           Referral Network Tree + Earnings                 │
│  /dao               DAO Governance + Voting                          │
│  /profile           User Profile + KYC Status                        │
│  /marketplace       NFT Marketplace (future)                         │
│  /documents         Documentation Hub                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### B. ADMIN CONSOLE (admin.missionchain.io) — Modules

```
┌─────────────────────────────────────────────────────────────────────┐
│                ADMIN CONSOLE — admin.missionchain.io                │
│                Next.js SSR + RBAC (4 roles)                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  MODULE 1: TOKEN & NFT MANAGEMENT                                   │
│  ├── MIC Token Overview (supply, burned, circulating)               │
│  ├── MFP-NFT Management (mint, view holders, expansion vote)        ��
│  ├── Community NFT Management (mint, view, adjust multipliers)      │
│  ├── MICE License Overview (active, expired, revenue)               │
│  └── Bulk Operations (batch mint, batch whitelist)                  │
│                                                                     │
│  MODULE 2: SALES & REVENUE                                          │
│  ├── SEED Round Dashboard                                           │
│  │   ├── Sold / Remaining / Time left                               │
│  │   ├── Whitelist Management (add/remove KYC addresses)            │
│  │   ├── Package Stats (which packages sold most)                   │
│  │   └── End Round → Burn unsold MIC                                │
│  ├── Pre-Sale Dashboard                                             │
│  │   ├── Sold / Remaining / Time left                               │
│  │   ├── Adjust Bonus % per Package ← RED NOTE                     ���
│  │   └── End Round → Burn unsold MIC                                │
│  ├── Referral Management                                            │
│  │   ├── Adjust F1/F2 Rates (1%-10%) ← RED NOTE                   │
│  │   ├── View Referral Tree                                         │
│  │   └── Top Referrers Leaderboard                                  │
│  └── Airdrop Campaign Management                                    │
│      ├── Create Campaign (upload CSV → merkle tree)                 │
│      ├── Set/Update Merkle Root                                     │
│      └── Track Claims                                               │
│                                                                     │
│  MODULE 3: TREASURY & FINANCE                                       │
│  ├── Treasury Overview (all pool balances)                          │
│  │   ├── SeedSale Pool         │  Airdrop Pool                     │
│  │   ├── PreSale Pool          │  Founders Pool                    │
│  │   ├── DAO Reserve           │  Churches/Community               │
│  │   └── Operations Pool                                            │
│  ├── Fund Transfer (between pools)                                  │
│  │   ├── Max ±5% per transfer ← RED NOTE                          │
│  │   ├── Max 2 transfers/month per pool ← RED NOTE                │
│  │   └── Requires DAOGovernor 3-of-5 signature                     │
│  ├── Liquidity Management                                           │
│  │   ├── Current LP Position (MIC/USDT)                            │
│  │   ├── Add/Remove Liquidity                                       │
│  │   └── Auto-Add Settings                                          │
│  ├── Buyback & Burn                                                 │
│  │   ├── Pending USDT for buyback                                   │
│  │   ├── Execute Buyback                                            │
│  │   ├── Total Burned History                                       │
│  │   └── Auto-Buyback Settings                                      │
│  └── Lock Schedule Overview (FIXED — read-only monitoring)         │
│      ├── All schedules by category                                  │
│      ├── Upcoming auto-unlocks                                      │
│      └── (No claim action needed — auto-unlock only)                │
│                                                                     │
│  MODULE 4: EMISSION & MINING                                        │
│  ├── Emission Dashboard                                             │
│  │   ├── Today's E(t) = E_base × D(t) × R(t) × W(t)              │
│  │   ├── Cumulative Emitted / Remaining                             │
│  │   ├── Split Ratio Adjustment (±10%) ← RED NOTE                 │
│  │   │   └── Miners/Staking/DAO/Burn sliders (total must = 100%)  │
│  │   └── Emission History Chart                                     │
│  ├── MICE License Management                                        │
│  │   ├── Active/Expired/Total                                       │
│  │   ├── Price Step Adjustment ← RED NOTE                          │
│  │   │   └── Base Price ($100-$500) + Range ($200-$1500)           │
│  │   └── Revenue Split View (50/30/20)                              │
│  ├── Mining Pool Management                                         │
│  │   ├── Submit Hindex Scores (batch oracle)                        │
│  │   ├── Epoch Management (start/finalize)                          │
│  │   └── Miner Leaderboard                                         │
│  └── NFT Staking Management                                        │
│      ├── Total Staked / TVL                                         │
│      ├── Tier Distribution                                          │
│      ├── Multiplier Adjustment ← RED NOTE                          │
│      └── Circuit Breaker Status (10% daily unstake)                 │
│                                                                     │
│  MODULE 5: SYSTEM & SECURITY                                        │
│  ├── Circuit Breaker Dashboard                                      │
│  │   ├── CB-1: Cumulative Cap (5.95B) — status                     │
│  │   ├── CB-2: Daily Cap (2×E_base) — status                      │
│  │   ├── CB-3: Price Floor ($0.001) — toggle                       │
���  │   ├── CB-4: Unstake Limit (10%/day) — monitor                  │
│  │   └── CB-5: Emergency Pause — DAOGovernor trigger               │
│  ├── Oracle Management                                              ���
│  │   ├── ROI Oracle Status                                          │
│  │   ├── Price Oracle (PancakeSwap TWAP)                            │
│  │   └── Hindex Oracle (daily cron)                                 │
│  ├── Contract Roles                                                 │
│  │   ├── View all role assignments                                  │
│  │   ├── Grant/Revoke roles (via DAOGovernor)                       │
│  │   └── Audit log                                                  │
│  ├── Event Logs / Transaction History                               │
│  └── System Config (read from DB system_config table)               │
│                                                                     │
└───────────────────────────────────��─────────────────────────────────┘
```

---

## VI. FRONTEND PAGE-BY-PAGE — Detailed Functions

### / Dashboard (Portfolio Overview)

```
┌─ READS FROM ONCHAIN ─────────────────────────────────────────────┐
│ MICToken.balanceOf(wallet)           → MIC Balance               │
│ USDT.balanceOf(wallet)               → USDT Balance              │
│ LockManager.getSchedules(wallet)      → Vesting count + locked amount │
│ MICELicense.activeCountOf(wallet)    → Active MICE count         │
│ MFPNFT.balanceOf(wallet)            → MFP NFT count             │
│ CommunityNFT.highestActiveTier()    → Current NFT tier          │
│ NFTStaking.getUserStakes()          → Staked MIC amount          │
│ MiningPool.pendingReward()          → Mining pending             │
│ ReferralRegistry.getReferralInfo()  → Referral earnings          │
├─ READS FROM BACKEND ─────────────────────────────────────────────┤
│ GET /api/portfolio/summary           → Aggregated portfolio data │
│ GET /api/emission/current            → Today's emission rate     │
│ GET /api/prices/mic                  → MIC price (cached TWAP)   │
└──────────────────────────────────────────────────────────────────┘

DISPLAYS:
  • Total Portfolio Value (USD)
  • MIC Balance + Locked/Unlocking
  • Active MICE Licenses (with expiry countdown)
  • NFT Tier Badge (MFP/Luminary/Maker/Builder)
  • Pending Mining Rewards (live counter, update every 5s)
  • Quick Claim buttons
  • Emission Progress Bar (total emitted / 5.95B)
```

### /seed — SEED Round Purchase

```
VISIBILITY: Only when SEED round is active

┌─ ONCHAIN READS ──────────────────────────────────────────────────┐
│ SeedSale.active()                    → Is round open?            │
│ SeedSale.totalRaised()              → USDT raised so far        │
│ SeedSale.HARD_CAP()                 → $568,750 total            │
│ SeedSale.totalAllocated()           → MIC allocated             │
│ SeedSale.whitelisted(wallet)        → KYC status                │
│ SeedSale.contributions(wallet)      → User's contribution       │
│ SeedSale.packages(0..3)            → Package details            │
│ USDT.balanceOf(wallet)              → User USDT balance         │
│ USDT.allowance(wallet, SEED)        → Current approval          │
├─ ONCHAIN WRITES ─────────────────────────────────────────────────┤
│ USDT.approve(SEED_SALE, amount)     → Step 1: Approve           │
│ SeedSale.purchasePackage(index)     → Step 2: Buy package       │
│  OR                                                              │
│ SeedSale.purchaseWithUSDT(amount)   → Custom amount (no NFT)    │
├─ BACKEND ────────────────────────────────────────────────────────┤
│ GET /api/auth/check-kyc             → KYC verification           │
│ POST /api/seed/record               → Save tx to DB             │
│ GET /api/seed/stats                 → Sale stats (cached)        │
└──────────────────────────────────────────────────────────────────┘

DISPLAYS:
  • Progress bar: raised / hard cap
  • Remaining MIC allocation
  • Time remaining (countdown)
  • 4 Package Cards:
    EARLY BIRD:     $1,000 → 400K MIC + 20 MFP-NFT
    FOUNDING I:     $2,500 → 1M MIC + 60 MFP-NFT
    FOUNDING II:    $5,000 → 2M MIC + 150 MFP-NFT
    FOUNDING III:   $10,000 → 4M MIC + 350 MFP-NFT
  • KYC status badge
  • Purchase history
```

### /presale — Pre-Sale Purchase

```
┌─ ONCHAIN ────────────────────────────────────────────────────────┐
│ READ:                                                            │
│   PreSale.active(), totalRaised(), HARD_CAP()                   │
│   PreSale.contributions(wallet)                                  │
│   ReferralRegistry.registered(wallet)                            │
│   ReferralRegistry.referrer(wallet)                              │
│ WRITE:                                                           │
│   USDT.approve(PRESALE, amount)                                  │
│   PreSale.purchaseWithUSDT(amount)                               │
│     → Internally: transfers MIC to wallet + creates lock schedule   │
├─ BACKEND ────────────────────���───────────────────────────────────┤
│ GET /api/auth/check-referrer?ref=xxx → Validate referral code    │
│ POST /api/presale/record             → Save tx to DB             │
└──────���───────────────────────────���───────────────────────────────┘

DISPLAYS:
  • Progress bar: raised / $1.575M
  • Minimum $25 purchase (no package required)
  • 3 Packages with NFT bonus (per Final Specs Apr 7):
    Builder:   $1,000  → 200K MIC + Builder NFT
    Maker:     $2,500  → 500K MIC + Maker NFT
    Luminary:  $5,000  → 1M MIC   + Luminary NFT
  • Referral code input + referral link
  • "All MIC locked via LockManager (6mo cliff → 10% unlock → 2.5%/mo) — auto-unlock, no claim needed"
```

### /vesting — Lock Schedule (Token-Level)

```
┌─ ONCHAIN ────────────────────────────────────────────────────────┐
│ READ:                                                            │
│   LockManager.getSchedules(wallet)     → schedule IDs           │
│   LockManager.getSchedule(id)          → full details           │
│   LockManager.lockedOf(wallet)         → locked MIC (view, 0 gas) │
│   LockManager.availableOf(wallet)      → available MIC now      │
│ WRITE:                                                           │
│   (No claim needed — tokens auto-unlock at schedule milestones) │
└��─────────────────────────────────────────────────────────────────┘

DISPLAYS:
  • Timeline visualization (cliff → unlock → monthly)
  • Per-schedule card: category, total, locked, available, next unlock
  • All MIC visible on BSCScan (tokens in user wallet, locked tracking off-chain)
  • Total locked/available across all schedules
```

### /mice — MICE License

```
┌─ ONCHAIN ───���────────────────────────────────────────────────────┐
│ READ:                                                            │
│   MICELicense.currentPrice()           → Dynamic price           │
│   MICELicense.activeLicenses()         → Global active count     │
│   MICELicense.getUserLicenses(wallet)  → User's licenses         │
│   MICELicense.licenses(id)             → License details         │
│ WRITE:                                                           │
│   USDT.approve(MICE, price)                                      │
│   MICELicense.purchase()               → Buy new license         │
│   MICELicense.renew(id)               → Extend +360 days        │
└──────────────────────────────────────────────────────────────────┘

DISPLAYS:
  • 5-Round fixed pricing: $100 / $200 / $300 / $400 / $500
  • Round progress indicator (20K per round)
  • Active licenses / 100,000 max
  • User's licenses with expiry countdown
  • Payment: 50% USDT + 50% MIC (burned). USDT portion → RevenueRouter (35% Marketing / 7.5% Mgmt / 12.5% Treasury + 5% Reserved Staking / 40% Liquidity)
  • Referral: F1:7% + F2:3% on USDT portion only
  • "Purchase" + "Renew" buttons
```

### /mining — Mining Pool

```
┌─ ONCHAIN ────────────────────────────────────────────────────────┐
│ READ:                                                            │
│   EmissionController.dailyEmission()    → Today's E(t)           │
��   EmissionController.totalEmitted()     → Cumulative             │
│   MICToken.remainingMiningPool()        → Remaining 85%          │
│   MiningPool.pendingReward(epoch, wallet) → Claimable           │
│   MiningPool.getScore(epoch, wallet)    → Hindex score          │
│   MICELicense.activeCountOf(wallet)     → Active MICE           │
│ WRITE:                                                           │
│   MiningPool.claimReward(epoch)         → Claim MIC              │
├─ BACKEND ────────────────────────────────────────────────────────┤
│ GET /api/mining/stats                   → Live emission data     │
│ GET /api/mining/hindex/:wallet          → Hindex breakdown       │
│ WebSocket: ws://api/emission/live       → Real-time counter      │
└────────────────────────��─────────────────────────────────────────┘

DISPLAYS:
  • 🔴 "Join Mining Pool" button (if has inactive MICE)
  • Live emission counter (animated, updates every 5s)
    "Total Mined: 1,234,567,890 MIC" with number rolling animation
  • Split visualization:
    60% Miners | 20% Staking | 15% DAO | 5% Burn
    (each with running counter)
  • Personal mining rewards (pending + claimed)
  • Hindex score breakdown
  • "Claim Reward" button
  • Emission decay chart (E_base over time)
```

### /nft — NFT Portfolio

```
┌─ ONCHAIN ────────────────────────────────────────────────────────┐
│ READ:                                                            │
│   MFPNFT.balanceOf(wallet)              → MFP count             │
│   MFPNFT.tokenOfOwnerByIndex(wallet, i) → Token IDs            │
│   CommunityNFT.highestActiveTier(wallet) → Best tier            │
│   CommunityNFT.getUserInstances(wallet)  → Instance IDs         │
│   CommunityNFT.instances(id)            → Tier + expiry         ���
│   CommunityNFT.remainingDays(id)        → Days left             │
│   MICELicense.getUserLicenses(wallet)   → License IDs           │
└──��───────────────────────────────────────────────────────────────┘

DISPLAYS:
  • NFT Collection Cards:
    MFP-NFT: [#ID] Founding Partner ×10 — Permanent
    Luminary: [#ID] ×5 — 234 days remaining
    Maker: [#ID] ×2.5 — 156 days remaining
    Builder: [#ID] ×1 — 45 days remaining
    MICE License: [#ID] — 280 days remaining
  • Current Staking Tier badge
  • 🔴 Inactive NFTs section: "Not joined mining pool"
    → "Join Mining Pool" button → NFT locked for duration
  • NFT metadata/artwork display
```

### /staking — MIC Staking (Stake MIC)

```
┌─ ONCHAIN ────────────────────────────────────────────────────────┐
│ READ:                                                            │
│   MICStaking.getUserStakes(wallet)     → Stake IDs              │
│   MICStaking.stakes(id)                → Stake details           │
│   MICStaking.pendingReward(id)         → Pending MIC             │
│   MICStaking.totalStakedAmount()       → Pool TVL                │
│   MICStaking.accRewardPerShare()       → Reward rate             │
│   MICToken.balanceOf(wallet)          → Available to stake      │
│   MICToken.allowance(wallet, STAKING) → Approval                │
�� WRITE:                                                           │
│   MICToken.approve(STAKING, amount)                              │
│   MICStaking.stake(amount, lockPeriod)  → Stake MIC             │
│   MICStaking.unstake(stakeId)           → Unstake (after lock)  │
│   MICStaking.claimRewards(stakeId)      → Claim only            ���
└──────────────────────────���───────────────────────────────────────┘

DISPLAYS:
  • Time-Lock Options (no NFT involvement):
    | Lock Period | Multiplier |
    | 30 days     | ×1.0       |
    | 90 days     | ×1.25      |
    | 180 days    | ×1.5       |
    | 360 days    | ×2.0       |
  • Stake form: amount + lock period selector
  • Active stakes list with unlock countdown
  • Pending rewards per stake
  • Estimated APY
  • No staking caps — stake any amount

#### Locked MIC Staking

Vesting-locked MIC (via LockManager) **can be staked** under these conditions:
  • **Full Multiplier**: Locked MIC earns at full time-lock multiplier (no reduction)
  • **Rewards Immediately Unlocked**: Staking rewards are freely transferable, not subject to vesting
  • **Minimum 360-Day Staking Lock**: Locked MIC must be staked with 360-day minimum lock period (achieves ×2.0 multiplier)
  • **No Staking Caps**: Pure MIC staking has unlimited per-address staking
  • **DAO Voting**: Only unlocked MIC counts toward voting weight

**Technical**: MICStaking.sol added to MICToken's `approvedStakingContracts` list to move locked tokens without _update() lock check.
```

### /network — Referral Network

```
┌─ ONCHAIN ────────────────────────────────────────────────────────┐
│ READ:                                                            │
│   ReferralRegistry.getReferralInfo(wallet) → F1/F2 counts       │
│   ReferralRegistry.referrer(wallet)        → My referrer         │
│   ReferralRegistry.registered(wallet)      → Status              │
├─ BACKEND ────────────────────────────────────────────────────────���
│ GET /api/referral/tree/:wallet        → Full tree visualization  │
│ GET /api/referral/earnings/:wallet    → Earnings history         │
│ GET /api/referral/code/:wallet        → Unique referral link     │
└──────────────────────��──────────────────────────────��────────────┘

DISPLAYS:
  • Referral link (copy button): missionchain.io/presale?ref=0xABC...
  • F1 Direct Referrals: count + total earnings
  • F2 Indirect Referrals: count + total earnings
  • Referral Tree visualization (expandable)
  • Earnings history table
  • Current commission rates: F1: X%, F2: Y%
```

---

## VII. DATABASE SCHEMA (PostgreSQL via Prisma)

```sql
-- Core user tables
users                    -- wallet_address, kyc_status, created_at
wallets                  -- user_id, address, chain_id, primary

-- Sales tracking (indexed from onchain events)
seed_participants        -- wallet, package, usdt_amount, mic_allocated, tx_hash, timestamp
presale_participants     -- wallet, usdt_amount, mic_allocated, bonus_mic, referrer, tx_hash
airdrop_claims          -- wallet, amount, merkle_leaf, claimed_at

-- NFT tracking (indexed)
nft_holdings            -- wallet, contract_type (MFP/COMMUNITY/MICE), token_id, tier, mint_time, expiry_time, active
nft_staking_positions   -- wallet, stake_id, amount, tier, lock_period, stake_time, unlock_time, active

-- Mining
mice_licenses           -- wallet, license_id, purchase_time, expiry_time, active, price_paid
hindex_scores           -- wallet, epoch, score, components (JSON), calculated_at
mining_rewards          -- wallet, epoch, amount, claimed, claimed_at

-- Financial
lock_schedules          -- wallet, schedule_id, category, total_amount, locked, available, start_time (indexed from onchain via LockManager)
referral_stats          -- wallet, referrer, f1_count, f2_count, total_earnings
treasury_transfers      -- from_pool, to_pool, token, amount, tx_hash, timestamp
buyback_history         -- usdt_spent, mic_burned, tx_hash, timestamp
liquidity_events        -- type (ADD/REMOVE), usdt, mic, lp_tokens, tx_hash, timestamp

-- System
tx_history              -- wallet, contract, function, tx_hash, status, block, timestamp (all events)
emission_daily          -- day, e_base, demand_factor, roi_factor, total_emission, to_miners, to_staking, to_dao, to_burn
notifications           -- user_id, type, message, read, created_at
admin_logs              -- admin_wallet, action, details (JSON), timestamp
system_config           -- key, value, updated_by, updated_at
```

---

## VIII. BACKEND SERVICES (api.missionchain.io)

```
┌─ REST API ROUTES ────────────────────────────────────────────────┐
│                                                                   │
│ AUTH:                                                             │
│   POST /auth/nonce          → Generate sign-in nonce             │
│   POST /auth/verify         → Verify signature, issue JWT        │
│   GET  /auth/check-kyc      → Check KYC status (Sumsub)         │
│                                                                   │
│ PORTFOLIO:                                                        │
│   GET  /portfolio/summary   → Aggregated portfolio data           │
���   GET  /portfolio/history   → Balance history (chart data)        │
│                                                                   │
│ SALES:                                                            │
│   GET  /seed/stats          → SEED round statistics               │
│   GET  /presale/stats       → Pre-sale statistics                 │
│   POST /seed/record         → Record purchase (from event)        │
│   POST /presale/record      → Record purchase (from event)        │
│                                                                   │
│ MINING:                                                           │
│   GET  /mining/stats        → Emission + mining stats             │
│   GET  /mining/hindex/:addr → Hindex breakdown for user           │
│   GET  /mining/leaderboard  → Top miners                          │
│                                                                   │
│ REFERRAL:                                                         │
│   GET  /referral/tree/:addr → Referral tree                       │
│   GET  /referral/earnings   → Earnings history                    │
│   GET  /referral/code/:addr → Referral link                       │
│                                                                   │
│ PRICES:                                                           │
│   GET  /prices/mic          → MIC/USDT price (cached TWAP)       │
���   GET  /prices/bnb          → BNB/USDT price                     │
│   GET  /prices/mice         → Current MICE license price         │
│                                                                   │
│ ADMIN (RBAC):                                                     │
│   POST /admin/whitelist     → Batch KYC whitelist                │
│   POST /admin/airdrop/root  → Set merkle root                    │
│   GET  /admin/treasury      → All pool balances                  │
│   POST /admin/treasury/transfer → Transfer between pools         │
│   POST /admin/emission/split → Update emission split              │
│   POST /admin/referral/rates → Update F1/F2 rates                │
│   POST /admin/presale/packages → Update PreSale packages + NFT tiers │
│   POST /admin/mice/pricing   → Update MICE pricing               │
│   POST /admin/nft/multipliers → Update NFT multipliers           │
│   GET  /admin/logs           → Audit trail                        │
│                                                                   │
├─ BACKGROUND SERVICES ────────────────────────────────────────────┤
│                                                                   │
│ EVENT INDEXER (always running):                                    │
│   Listen BSC events from all contracts                            │
│   Index into PostgreSQL                                           │
│   Update cached data                                              │
│                                                                   │
│ DAILY KEEPER (cron, 1x/day):                                      │
│   1. Read MICELicense.activeCount()                               │
│   2. Read price oracle → compute ROI                              │
│   3. Call EmissionController.updateROI()                           │
│   4. Call EmissionController.distributeDaily()                     │
│   5. Compute Hindex scores from DB                                │
│   6. Call MiningPool.submitHindexBatch()                          │
│   7. Call MiningPool.finalizeEpoch()                              │
│   8. Update NFTStaking tiers (oracle check NFT holdings)          │
│   9. Check expired MICE/CommunityNFT, call expireInstances()      │
│  10. Auto-buyback if threshold reached                             ��
│                                                                   │
│ PRICE ORACLE (cron, every 5 min):                                 │
│   Read PancakeSwap V3 TWAP                                        │
│   Cache MIC/USDT price                                            │
│   Check CB-3 price floor ($0.001)                                 │
│                                                                   │
│ WEBSOCKET (real-time):                                             │
│   ws://api/emission/live → Push emission counter updates          │
│   ws://api/portfolio/live → Push balance changes                  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## IX. DEPLOYMENT ORDER (16 Contracts)

```
Phase 1: Core Token + Lock Manager
  1. MockUSDT (testnet only)
  2. MICToken → mint 1.05B to deployer/treasury
  3. LockManager (replaces VestingManager)

Phase 2: NFTs
  4. MFPNFT → grant MINTER_ROLE to deployer temporarily
  5. CommunityNFT → grant MINTER_ROLE to deployer temporarily

Phase 3: Sales
  6. ReferralRegistry
  7. SeedSale → set MFPNFT, grant MINTER_ROLE on MFPNFT to SeedSale
  8. PreSale → set ReferralRegistry

Phase 4: Airdrop
  9. AirdropDistributor

Phase 5: Mining
  10. MICELicense
  11. MiningPool

Phase 6: Staking
  12. NFTStaking

Phase 7: Emission Engine
  13. EmissionController → grant MINTER_ROLE on MICToken

Phase 8: Treasury & Liquidity  ← NEW
  14. TreasuryManager
  15. LiquidityManager → set PancakeSwap router
  16. BuybackBurn → set PancakeSwap router

Phase 9: Fund Distribution
  Transfer MIC from deployer to:
  - SeedSale:          227,500,000 MIC
  - PreSale:           315,000,000 MIC
  - LockManager:       385,000,000 MIC (Founders + Treasury DAO vesting schedules)
  - AirdropDistributor: 17,500,000 MIC
  - DEX reserve:       105,000,000 MIC (→ LiquidityManager)

Phase 10: Role Finalization
  - Transfer DEFAULT_ADMIN_ROLE to DAOGovernor
  - Revoke deployer roles
  - Set MICE revenue wallets (Treasury, Liquidity, Buyback)
```

---

## X. LOCK SCHEDULES — ALL 6 CATEGORIES (Tracked by LockManager)

| Category | MIC | Cliff | Initial Unlock | Monthly | 100% At |
|----------|-----|-------|---------------|---------|---------|
| Incentives & Airdrops (0.25%) | 17.5M | 6 months | 10% | 2.5% | Month 42 |
| **SEED Round (3.25%)** | 227.5M | **6 months** | **10%** | **2.5%** | **Month 42** |
| **Pre-Sale (4.50%)** | 315M | **6 months** | **10%** | **2.5%** | **Month 42** |
| DEX/CEX Listing (1.50%) | 105M | At listing | 100% | — | Immediate |
| Founders & Mgmt (4.00%) | 280M | **24 months** | 10% | 2.5% | Month 60 |
| Treasury DAO (1.50%) | 105M | **24 months** | 10% | **2.5%** | Month 60 |

**Lock Schedule Details:** SEED and Pre-Sale share THE SAME lock schedule (6m cliff, 10% unlock, 2.5%/month). Founders and Treasury have DIFFERENT schedules. All tokens go directly to user wallets; LockManager only tracks and enforces unlocking milestones (zero gas for view functions).

---

## XI. SMART CONTRACT INTERACTION MAP

```
                           ┌──────────────┐
                           │ GNOSIS SAFE  │
                           │   3-of-5     │
                           └──────┬───────┘
                                  │ DEFAULT_ADMIN_ROLE (all contracts)
        ┌─────────────────────────┼──────────────────────────────┐
        │                         │                              │
  ┌─────┴─────┐           ┌──��───┴──────┐              ┌────────┴────────┐
  │①MICToken  │←MINTER────│⑬Emission   │              │⑭TreasuryMgr    │
  │ BEP-20    │  ROLE     │ Controller  │              │ Fund alloc      │
  │ 7B cap    │           │ E(t) daily  │              │ ±5%, 2x/month  │
  └─────┬─────┘           └──────┬──────���              └────────┬────────┘
        │                   split │ 60/20/15/5                   │
        │              ┌─────────┼──────────┐                    │
        ↓              ↓         ↓          ↓                    │
  ┌──────────┐  ���──────────┐ ┌─────────┐ ┌─────────┐    ┌──────┴──────┐
  │②Lock     │  │⑨Mining   │ │⑩NFT     │ │⑯Buyback │    │⑮Liquidity  │
  │ Manager  │  │ Pool     │ │ Staking │ │ Burn    │    │ Manager    │
  └────┬─────┘  └──────────┘ └─────────┘ └─────────┘    └────────────┘
       │                          ↑
  ┌────┼────┐              Oracle reads:
  │    │    │         ┌───────────┴──────────┐
  ↓    ↓    ↓         │                      │
┌───┐┌───┐┌───┐  ┌───────┐  ┌──────────┐┌──────────┐
│③  ││⑤  ││⑥  │  │⑦MICE  │  │⑪MFP-NFT ││⑫Community│
│Seed││Pre││Air│  │License │  │ ERC-721  ││ NFT 1155 │
│Sale││Sale│drop│  │ERC-1155│  │ 25K cap  ││ 3 tiers  │
└───┘└─┬──┘└───┘  └────────┘  └──────────┘└───��──────┘
       │
       ↓
  ┌─���────────┐
  │④Referral │
  │ Registry │
  │ F1/F2    │
  └──────────┘
```

---

## XII. REVENUE FLOW MAP

```
REVENUE SOURCE              DISTRIBUTION                    CONTRACT
═══════════════════════════════════════════════════════════════════════
SEED Round ($568.75K)    →  100% SeedBudget               → SeedBudget (50% Operational / 50% Net Capital)
Pre-Sale ($1.575M)       →  F1:7%+F2:3% instant           → ReferralRegistry
                            90% net → RevenueRouter       → 35% RewardDistributor / 7.5% MgmtPool / 12.5% TreasuryDAO / 5% StakingFund / 40% LiquidityPool
                            RewardDistributor (35%)       → ClaimRewards (21.5%) + PeriodicRewards (10%) + LuckyDraw (1%) + IncentivePool (2.5%)
MICE License (USDT 50%)  →  F1:7%+F2:3% on USDT portion   → ReferralRegistry
                            90% net → MICERevenueRouter   → 35% RewardDistributor / 7.5% MgmtPool / 12.5% TreasuryDAO / 5% StakingFund / 40% LiquidityPool
                            RewardDistributor (35%)       → ClaimRewards (21.5%) + PeriodicRewards (10%) + LuckyDraw (1%) + IncentivePool (2.5%)
MICE License (MIC 50%)   →  100% BURNED (0xdead)           → Deflationary

Daily Emission (85%)     →  60% MiningPool                → MiningPool
                            20% NFTStaking                → NFTStaking
                            15% DAO Treasury              → TreasuryManager
                             5% Burn (0xdEaD)             → BuybackBurn       ← NEW
```
