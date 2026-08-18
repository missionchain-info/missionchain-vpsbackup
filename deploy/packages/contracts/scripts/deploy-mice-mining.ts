/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MISSION CHAIN — MICE · MINING · SWAP deploy (design frozen 2026-08-05)
 * ─────────────────────────────────────────────────────────────────────────────
 * Deploys the Liquidity, Sales and Emission layers and wires them together.
 * Spec:   docs/superpowers/specs/2026-08-05-mice-mining-swap-design.md
 * Policy: docs/superpowers/specs/2026-08-05-economic-guardrails-operating-policy.md
 *
 * RUNS AFTER the PreSale Phase-1 set is live — MICE needs RevenueRouter and
 * ReferralRegistry, both of which ship with that deploy.
 *
 * SAFETY: dry-run by default. Prints the plan and pre-flight checks; sends nothing
 * unless EXECUTE=1.
 *   Review:   npx hardhat run scripts/deploy-mice-mining.ts --network bsc
 *   Execute:  EXECUTE=1 npx hardhat run scripts/deploy-mice-mining.ts --network bsc
 *
 * PREREQUISITE THAT TAKES A WEEK: 50,000,000 MIC must already sit in the deployer
 * wallet, withdrawn from ListingReserveVault. That withdrawal has a 7-day cooldown
 * (requestWithdraw → wait → executeWithdraw), so start it well before deploy day.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ethers } from "hardhat"
import fs from "fs"
import path from "path"

// ── Live mainnet dependencies ────────────────────────────────────────────────
const MAINNET = {
  USDT:                "0x55d398326f99059fF775485246999027B3197955",
  MIC:                 "0xf27ec0c311728b923b22828002c992c799326182",
  DAOGovernor:         "0xDCD65DC97b0A147BeCf542E22a5C218C006231cC",
  ListingReserveVault: "0x2EE1b6B7108851BB721cA1c9B8aCEf76e70C8f16",
}

// ── From the PreSale Phase-1 deploy — FILL BEFORE RUNNING ───────────────────
/**
 * Live from the PreSale Phase-1 deploy, 2026-08-08. Both verified on BSCScan.
 *
 * MICE feeds the same revenue router and the same referral ledger as the Pre-Sale, so a
 * MICE purchase splits six ways and counts toward the buyer's Group Volume exactly as a
 * Pre-Sale purchase does. Pointing these at anything else would fork the accounting.
 */
const PRESALE_SET = {
  RevenueRouter:    "0xf86b0cF9ce21250429b522Ed62a5B6b549539672",
  ReferralRegistry: "0x2a8C0c5c7414fD4f879ba34883652f306403f0f9",
}

// ── Frozen parameters. Changing any of these changes published tokenomics. ──
const CONFIG = {
  /// Admin for the new contracts. Phase 1 Full uses a Gnosis Safe, not an EOA.
  ADMIN: "0xD32e666381b56f979D60C57831838f05F33AD6c2",

  /// MIC seeded into the pool.
  POOL_MIC: ethers.parseUnits("50000000", 18),
  /// Opening reference price: $0.01 per MIC, expressed in 18-decimal USDT.
  OPENING_PRICE: ethers.parseUnits("0.01", 18),
  /// Virtual reserve = opening price × MIC seed = $500,000.
  ///
  /// This was `parseUnits("500000", 6)` — $0.0000005 against BSC-USD, which is 18
  /// decimals. The virtual reserve is what anchors the opening price, so an anchor of
  /// nearly zero would have priced MIC at nothing from the pool's first block.
  VIRTUAL_RESERVE: ethers.parseUnits("500000", 18),
}

async function main() {
  const EXECUTE = process.env.EXECUTE === "1"
  const [deployer] = await ethers.getSigners()
  const admin = CONFIG.ADMIN
  const out: Record<string, string> = {}

  console.log("═".repeat(78))
  console.log("MICE · MINING · SWAP deploy" + (EXECUTE ? "  [EXECUTE]" : "  [DRY-RUN]"))
  console.log("═".repeat(78))
  console.log("Deployer:", deployer.address)
  console.log("Admin   :", admin)

  // ═══════════════ PRE-FLIGHT ═══════════════
  const problems: string[] = []
  const warn = (c: boolean, msg: string) => { if (!c) problems.push(msg) }

  if (!PRESALE_SET.RevenueRouter || !PRESALE_SET.ReferralRegistry) {
    problems.push("PRESALE_SET is empty — paste the RevenueRouter and ReferralRegistry addresses from the PreSale deploy")
  } else {
    // A non-empty string proves nothing: a typo, a testnet address or an EOA all pass
    // that check and only fail once roles are being granted, half way through the run.
    for (const [name, addr] of Object.entries(PRESALE_SET)) {
      const code = await ethers.provider.getCode(addr)
      if (code === "0x") problems.push(`PRESALE_SET.${name} (${addr}) has no contract code on this network`)
    }
  }

  const mic = await ethers.getContractAt("MICToken", MAINNET.MIC)
  console.log("\n── pre-flight ──")

  // Reads are wrapped so a dry-run on a network without the live dependencies still
  // prints the whole plan instead of dying on the first call.
  let MINTER = ethers.ZeroHash
  try {
    const micBal = await mic.balanceOf(deployer.address)
    console.log("  deployer MIC :", ethers.formatUnits(micBal, 18), "(not needed here — seeding is a separate step)")
    MINTER = await mic.MINTER_ROLE()
  } catch {
    console.log("  deployer MIC : UNREADABLE — MIC token not present on this network")
    problems.push("cannot read the MIC token — are you on --network bsc?")
  }

  const bnb = await ethers.provider.getBalance(deployer.address)
  console.log("  deployer BNB :", ethers.formatEther(bnb))
  warn(bnb > ethers.parseEther("0.08"), "BNB below ~0.08 — top up before executing")

  try {
    const vault = await ethers.getContractAt("ListingReserveVault", MAINNET.ListingReserveVault)
    console.log("  ListingReserveVault MIC:", ethers.formatUnits(await (vault as any).vaultBalance(), 18))
  } catch { console.log("  ListingReserveVault: unreadable on this network") }

  console.log("\n── plan ──")
  // The whole config above is written in 18 decimals. Read the live token rather than
  // trusting it — this exact mismatch reached mainnet twice before.
  const usdtMeta = await ethers.getContractAt("IERC20Metadata", MAINNET.USDT)
  const usdtDecimals = await usdtMeta.decimals()
  console.log("USDT decimals        :", usdtDecimals.toString(), Number(usdtDecimals) === 18 ? "✓" : "✗ EXPECTED 18")
  if (Number(usdtDecimals) !== 18) {
    console.log("❌ Aborting: every price and threshold in this batch assumes 18 decimals.")
    process.exit(1)
  }

  console.log("  1. LiquidityPoolV6      DORMANT — deployed unseeded, clock starts at the seed")
  console.log("  2. (seeding deferred — see activate-swap.ts)")
  console.log("  3. MICELicense          reads min(spot, TWAP7d) from the pool")
  console.log("  4. MiningPool (per-licence accrual), NFTStaking")
  console.log("  5. CommunityNFTRewardPool ×2  (Community NFT 5%, MFP-NFT 1%)")
  console.log("  6. EmissionController   E₀ 750,000/day, half-life 8 years, split 59/25/10/5/1")
  console.log("  7. wire roles — RevenueRouter keeps pointing at LiquidityPool v4 until activation")

  if (problems.length) {
    console.log("\n❌ BLOCKERS")
    problems.forEach(p => console.log("   •", p))
  }
  if (!EXECUTE) {
    console.log("\n🧪 DRY-RUN complete — nothing sent. Set EXECUTE=1 to broadcast.")
    return
  }
  if (problems.length) { console.log("❌ Aborting: fix the blockers above."); process.exit(1) }

  // ═══════════════ DEPLOY ═══════════════
  const deploy = async (name: string, args: any[], label?: string) => {
    const F = await ethers.getContractFactory(name)
    const c = await F.deploy(...args)
    await c.waitForDeployment()
    const addr = await c.getAddress()
    out[label ?? name] = addr
    console.log(`  ✓ ${(label ?? name).padEnd(26)} ${addr}`)
    return c
  }

  console.log("\n── deploy ──")
  const pool = await deploy("LiquidityPoolV6",
    [MAINNET.USDT, MAINNET.MIC, CONFIG.VIRTUAL_RESERVE, admin])

  const mice = await deploy("MICELicense", [
    MAINNET.USDT, MAINNET.MIC,
    PRESALE_SET.ReferralRegistry, PRESALE_SET.RevenueRouter,
    admin, await pool.getAddress(),
  ])

  const miningPool  = await deploy("MiningPool",  [MAINNET.MIC, admin])
  const nftStaking  = await deploy("NFTStaking",  [MAINNET.MIC, admin])
  const cnftPool    = await deploy("CommunityNFTRewardPool", [MAINNET.MIC, admin], "CommunityNFTRewardPool")
  const mfpPool     = await deploy("CommunityNFTRewardPool", [MAINNET.MIC, admin], "MFPRewardPool")

  const emission = await deploy("EmissionController", [
    MAINNET.MIC, await mice.getAddress(),
    await miningPool.getAddress(), await nftStaking.getAddress(),
    MAINNET.DAOGovernor,                       // DAO Treasury 10%
    await cnftPool.getAddress(),               // Community NFT 5%
    await mfpPool.getAddress(),                // MFP-NFT 1%
    admin,
  ])

  // Seeding lives in activate-swap.ts. The pool is deployed dormant: it holds no MIC,
  // quotes no price, refuses trades and refuses revenue, and its clock has not started.
  // Nothing measured from "pool age" begins until the seed, so the wait costs nothing.
  const R = async (label: string, fn: Promise<any>) => { const tx = await fn; await tx.wait(); console.log("  ✓", label) }

  // ═══════════════ WIRE ═══════════════
  console.log("\n── wire ──")
  const role = async (c: any, n: string) => c[n]()

  const registry = await ethers.getContractAt("ReferralRegistry", PRESALE_SET.ReferralRegistry)
  const router   = await ethers.getContractAt("RevenueRouter",    PRESALE_SET.RevenueRouter)

  // MICE sells: it calls the registry and the router, exactly as PreSale does, so its
  // volume lands in the SAME group-volume ledger and ranks combine across both sales.
  await R("ReferralRegistry.CALLER → MICELicense",
    registry.grantRole(await role(registry, "CALLER_ROLE"), await mice.getAddress()))
  await R("RevenueRouter.DISTRIBUTOR → MICELicense",
    router.grantRole(await role(router, "DISTRIBUTOR_ROLE"), await mice.getAddress()))

  // NOT repointed here. The router's 40% slice keeps going to LiquidityPool v4 until the
  // new pool is seeded — USDT arriving first would set the opening price above the
  // published $0.01, because price is reserve over MIC and there would be no MIC yet.
  // `activate-swap.ts` repoints it in the same transaction batch as the seed.
  await R("LiquidityPoolV6.DISTRIBUTOR → RevenueRouter",
    (pool as any).grantRole(await role(pool, "DISTRIBUTOR_ROLE"), PRESALE_SET.RevenueRouter))

  // The Emission layer reports its own 7-day average to the pool, which needs it to
  // price the sell fee. Reads stay Emission → Liquidity.
  await R("LiquidityPoolV6.EMISSION_REPORTER → EmissionController",
    (pool as any).grantRole(await role(pool, "EMISSION_REPORTER_ROLE"), await emission.getAddress()))
  await R("EmissionController.setLiquidityPool(pool, $0.01)",
    (emission as any).setLiquidityPool(await pool.getAddress(), CONFIG.OPENING_PRICE))

  // ── MICE ↔ Mining ────────────────────────────────────────────────────────
  // Rewards accrue per licence, by the second, from the moment of activation. That only
  // works if the pool hears about activation, expiry and resale — MICELicense is the
  // authority on all three, and the pool merely mirrors them.
  await R("MiningPool.LICENCE → MICELicense",
    (miningPool as any).grantRole(await role(miningPool, "LICENCE_ROLE"), await mice.getAddress()))
  await R("MiningPool.EMISSION → EmissionController",
    (miningPool as any).grantRole(await role(miningPool, "EMISSION_ROLE"), await emission.getAddress()))
  await R("MiningPool.setLicenceContract(MICELicense)",
    (miningPool as any).setLicenceContract(await mice.getAddress()))
  await R("MICELicense.setMiningPool(MiningPool)",
    (mice as any).setMiningPool(await miningPool.getAddress()))

  // The single most dangerous grant in the system. Nothing else may ever mint.
  await R("MICToken.MINTER → EmissionController",
    mic.grantRole(MINTER, await emission.getAddress()))

  // ═══════════════ SAVE ═══════════════
  const file = path.join(__dirname, `../deployments/mice-mining-${Date.now()}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(out, null, 2))
  console.log("\n✅ deployed — addresses written to", file)

  console.log("\n── STILL DORMANT ──")
  console.log("  The pool holds no MIC. Until `activate-swap.ts` runs:")
  console.log("    • SWAP refuses every trade          (LP6: pool not seeded)")
  console.log("    • MICE refuses every purchase       (MICE: no price)")
  console.log("    • the 30-day sell countdown has NOT started")
  console.log("    • do NOT start the mining keeper — distributeDaily reads the pool")

  console.log("\n── manual steps that are deliberately NOT automated ──")
  console.log("  • verify every contract on BSCScan")
  console.log("  • confirm MICToken.MINTER_ROLE is held by EmissionController and NOTHING else")
  console.log("  • move DEFAULT_ADMIN_ROLE to the Gnosis Safe / DAOGovernor")
  console.log("  • canary: buy one $100 licence, activate it, check the burn and the 6-way split")
  console.log("  • start the mining keeper (KEEPER_PK) — nothing emits, scores or expires without it")
  console.log("  • update packages/sdk/src/addresses.ts")
  console.log("  • the sell side opens on its own at day 30 via advancePhase() — no action needed")
}

main().catch(e => { console.error(e); process.exit(1) })
