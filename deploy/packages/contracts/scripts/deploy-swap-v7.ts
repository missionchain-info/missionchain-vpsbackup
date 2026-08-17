/**
 * ─────────────────────────────────────────────────────────────────────────────
 * LiquidityPoolV7 — deploy, seed, cut over.  MAINNET.
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces LiquidityPoolV6 (0xf6AB…C98e), which sells MIC at $0.02 against the
 * published $0.01. See MISSIONCHAIN_ISSUE_SWAP_PRICE.md for the diagnosis and
 * MISSIONCHAIN_RUNBOOK_SWAP_V7.md for the operating procedure this script serves.
 *
 * Three stages, each separately runnable, each dry-run unless EXECUTE=1:
 *
 *   STAGE=deploy    deploy V7 dormant, grant DISTRIBUTOR + EMISSION_REPORTER
 *   STAGE=router    repoint RevenueRouter → V7, so the 40% liquidity slice starts
 *                   accruing immediately. Safe before seeding: V7 accepts USDT while
 *                   dormant and one-for-one substitution keeps the opening price at
 *                   exactly $0.01 no matter how much arrives first.
 *   STAGE=seed      approve + seedMic(SEED_MIC) — starts the clock, opens buying
 *   STAGE=cutover   repoint MICELicense (and attempt EmissionController, which is frozen
 *                   to V6 by `require(openingPrice == 0)` and will refuse)
 *
 * They are separate on purpose. `seed` sets the opening price and cannot be undone
 * or re-run; `cutover` is what makes the pool live to users. Read the verify block
 * after each before starting the next.
 *
 *   Dry run : STAGE=deploy npx hardhat run scripts/deploy-swap-v7.ts --network bsc
 *   Execute : STAGE=deploy EXECUTE=1 npx hardhat run scripts/deploy-swap-v7.ts --network bsc
 *
 * SEED_MIC has no default. The opening price is virtualReserve0 / SEED_MIC, and
 * virtualReserve0 is fixed at construction — so seeding less than intended opens the
 * pool ABOVE $0.01, and a later top-up drops the price. Seed the whole float once.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ethers } from "hardhat"
import fs from "fs"
import path from "path"

const MAINNET = {
  MIC:                "0xf27ec0c311728b923b22828002c992c799326182",
  USDT:               "0x55d398326f99059fF775485246999027B3197955",
  RevenueRouter:      "0xf86b0cF9ce21250429b522Ed62a5B6b549539672",
  MICELicense:        "0x4d5147aC4aa44eFc1Ae6196FcE4c87567aA4BD8c",
  EmissionController: "0x37f38f383b4065BA58C7A6Fc1a91d2dF4f9f86F0",
  LiquidityPoolV6:    "0xf6AB7103d1072416366D34Ce5E8A41074feCC98e",
}

const OPENING_PRICE = ethers.parseUnits("0.01", 18)          // $0.01 per MIC, published

/** Real USDT the pool must take in before the sell side may open. Owner decision. */
const SELL_GATE = ethers.parseUnits(process.env.SELL_GATE || "25000", 18)
const RECORD = path.join(__dirname, "../deployments/swap-v7.json")

const stage   = process.env.STAGE || ""
const EXECUTE = process.env.EXECUTE === "1"

/** Float to seed, in whole MIC. Owner decision — see the runbook. */
const SEED_MIC = process.env.SEED_MIC ? ethers.parseUnits(process.env.SEED_MIC, 18) : 0n

function readRecord(): any {
  return fs.existsSync(RECORD) ? JSON.parse(fs.readFileSync(RECORD, "utf8")) : {}
}
function writeRecord(patch: any) {
  const merged = { ...readRecord(), ...patch }
  fs.mkdirSync(path.dirname(RECORD), { recursive: true })
  fs.writeFileSync(RECORD, JSON.stringify(merged, null, 2))
  console.log("  ↳ recorded in", path.relative(process.cwd(), RECORD))
}
function poolAddress(): string {
  return process.env.POOL || readRecord().LiquidityPoolV7 || ""
}

const send = async (label: string, fn: Promise<any>) => {
  const tx = await fn
  const r = await tx.wait()
  console.log(`  ✓ ${label}   tx ${r.hash}`)
}

async function main() {
  const [signer] = await ethers.getSigners()
  const net = await ethers.provider.getNetwork()

  console.log("═".repeat(78))
  console.log(`SWAP V7 · ${stage.toUpperCase() || "(no STAGE)"} ${EXECUTE ? "[EXECUTE]" : "[DRY-RUN]"}`)
  console.log("═".repeat(78))
  console.log("  chainId :", net.chainId.toString())
  console.log("  signer  :", signer.address)
  console.log("  BNB     :", ethers.formatEther(await ethers.provider.getBalance(signer.address)))

  if (net.chainId !== 56n) throw new Error(`refusing to run on chainId ${net.chainId} — use --network bsc`)
  if (!["deploy", "router", "seed", "cutover"].includes(stage)) {
    throw new Error("set STAGE=deploy | router | seed | cutover")
  }

  const mic: any = new ethers.Contract(MAINNET.MIC, [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function lockedBalanceOf(address) view returns (uint256)",
  ], signer)
  const problems: string[] = []

  // ─────────────────────────────────────────────────────────── deploy
  if (stage === "deploy") {
    if (SEED_MIC === 0n) {
      throw new Error("set SEED_MIC — virtualReserve0 is derived from it and is immutable")
    }
    // virtualReserve0 = P₀ × M. Computed here rather than passed in, so the opening price
    // cannot be wrong by typo the way LISTING_THRESHOLD once was.
    //
    // The build order says "set virtualReserve0 equal to V6's virtualReserve() so the
    // opening price does not jump". That instruction assumed V6's own 50M was moving
    // across, which it cannot be — V6 has no MIC exit. With a different float the same
    // intent is P₀ × M, which lands the opening price on $0.01 exactly for whatever M is
    // actually seeded. Reusing V6's 499,995 against a smaller float would open the pool
    // well above $0.01.
    const virtual0 = (SEED_MIC * OPENING_PRICE) / 10n ** 18n

    console.log("\n── plan ──")
    console.log("  seed float      :", ethers.formatUnits(SEED_MIC, 18), "MIC")
    console.log("  virtualReserve0 : $" + ethers.formatUnits(virtual0, 18))
    console.log("  opening price   : $" + ethers.formatUnits(OPENING_PRICE, 18), "per MIC")
    console.log("  sell gate       : $" + ethers.formatUnits(SELL_GATE, 18), "of REAL USDT")
    console.log("  admin           :", signer.address)
    if (SELL_GATE > virtual0) problems.push("sell gate above the virtual reserve — unreachable by substitution")

    if (readRecord().LiquidityPoolV7) {
      problems.push(`already deployed at ${readRecord().LiquidityPoolV7} — delete ${RECORD} to redeploy`)
    }
    if (problems.length) { console.log("\n❌ BLOCKERS"); problems.forEach(p => console.log("   •", p)); process.exit(1) }
    if (!EXECUTE) { console.log("\n🧪 DRY-RUN — nothing sent."); return }

    const pool: any = await (await ethers.getContractFactory("LiquidityPoolV7"))
      .deploy(MAINNET.USDT, MAINNET.MIC, virtual0, SELL_GATE, signer.address)
    await pool.waitForDeployment()
    const addr = await pool.getAddress()
    console.log("\n  ✓ LiquidityPoolV7 deployed:", addr)

    await send("grant DISTRIBUTOR_ROLE → RevenueRouter",
      pool.grantRole(await pool.DISTRIBUTOR_ROLE(), MAINNET.RevenueRouter))
    await send("grant EMISSION_REPORTER_ROLE → EmissionController",
      pool.grantRole(await pool.EMISSION_REPORTER_ROLE(), MAINNET.EmissionController))

    writeRecord({
      LiquidityPoolV7: addr,
      virtualReserve0: virtual0.toString(),
      sellGateUsdt:    SELL_GATE.toString(),
      seedMicPlanned:  SEED_MIC.toString(),
      deployedAt:      new Date().toISOString(),
      deployer:        signer.address,
    })

    console.log("\n── verify ──")
    console.log("  isSeeded  :", await pool.isSeeded(), "(false is correct — it is dormant)")
    console.log("  spotPrice : $" + ethers.formatUnits(await pool.spotPrice(), 18), "(0 until seeded)")
    console.log("  phase     :", (await pool.phase()).toString(), "(0 = Bootstrap, sells shut)")
    console.log("  sellGate  : $" + ethers.formatUnits(await pool.sellGateUsdt(), 18),
                "of REAL USDT before the sell side can open (not a date)")
    console.log("  sellFee    :", (await pool.sellFeeBps()).toString(),
                "bps now — falls to 0 as real capital replaces virtual")
    console.log("  micExit   : requestMicWithdraw → " +
                (Number(await pool.MIC_WITHDRAW_COOLDOWN()) / 86400) + "d → executeMicWithdraw")
    console.log("\n  next: verify on BSCScan, then STAGE=router")
    return
  }

  const addr = poolAddress()
  if (!addr) throw new Error("no V7 address — run STAGE=deploy first, or pass POOL=0x…")
  if ((await ethers.provider.getCode(addr)) === "0x") throw new Error(`no code at ${addr} on chainId ${net.chainId}`)
  const pool: any = await ethers.getContractAt("LiquidityPoolV7", addr)
  console.log("  pool    :", addr)

  // ─────────────────────────────────────────────────────────── router
  if (stage === "router") {
    const router: any = new ethers.Contract(MAINNET.RevenueRouter,
      ["function setLiquidity(address)", "function liquidity() view returns (address)"], signer)

    console.log("\n── pre-flight ──")
    const D = await pool.DISTRIBUTOR_ROLE()
    const hasD = await pool.hasRole(D, MAINNET.RevenueRouter)
    console.log("  RevenueRouter has DISTRIBUTOR on V7:", hasD)
    if (!hasD) problems.push("RevenueRouter lacks DISTRIBUTOR_ROLE on V7 — STAGE=deploy grants it")

    console.log("  current RevenueRouter.liquidity:", await router.liquidity())
    console.log("  V7 seeded:", await pool.isSeeded(), "(false is fine — it takes USDT while dormant)")
    console.log("  V7 reserveUsdt:", ethers.formatUnits(await pool.reserveUsdt(), 18))

    // The whole reason this stage can run before seeding. If it ever stopped being true,
    // pointing revenue here would open the pool off-price.
    const vr0 = await pool.virtualReserve0()
    const eff = await pool.effectiveUsdt()
    console.log("  effectiveUsdt:", ethers.formatUnits(eff, 18), "· virtualReserve0:", ethers.formatUnits(vr0, 18))
    if (eff !== vr0) {
      problems.push(`effectiveUsdt ${ethers.formatUnits(eff, 18)} != virtualReserve0 ` +
        `${ethers.formatUnits(vr0, 18)} — the opening price would no longer be $0.01`)
    }

    console.log("\n── plan ──")
    console.log("  RevenueRouter.setLiquidity(V7)  — the 40% slice starts landing here")
    console.log("  ⚠️  RevenueRouter calls receiveUSDT in the SAME transaction as a sale.")
    console.log("      V7 accepts it while dormant; a pool that reverted here would revert the sale.")

    if (problems.length) { console.log("\n❌ BLOCKERS"); problems.forEach(p => console.log("   •", p)); process.exit(1) }
    if (!EXECUTE) { console.log("\n🧪 DRY-RUN — nothing sent."); return }

    await send("RevenueRouter.setLiquidity(V7)", router.setLiquidity(addr))
    writeRecord({ routerRepointedAt: new Date().toISOString() })

    console.log("\n── verify ──")
    const after = await router.liquidity()
    console.log("  RevenueRouter.liquidity:", after, after.toLowerCase() === addr.toLowerCase() ? "✓" : "❌")
    if (after.toLowerCase() !== addr.toLowerCase()) process.exit(1)
    console.log("\n  ✅ revenue now accrues in V7. Next: STAGE=seed once the vault releases the MIC.")
    return
  }

  // ─────────────────────────────────────────────────────────── seed
  if (stage === "seed") {
    const planned = BigInt(readRecord().seedMicPlanned || "0")
    const amount  = SEED_MIC || planned
    if (amount === 0n) throw new Error("set SEED_MIC")
    if (planned && amount !== planned) {
      problems.push(`SEED_MIC ${ethers.formatUnits(amount, 18)} ≠ the ${ethers.formatUnits(planned, 18)} ` +
        `virtualReserve0 was sized for — the opening price would not be $0.01`)
    }

    console.log("\n── pre-flight ──")
    console.log("  already seeded :", await pool.isSeeded())
    if (await pool.isSeeded()) problems.push("pool is already seeded — re-seeding would move the opening price")

    const bal = await mic.balanceOf(signer.address)
    console.log("  signer MIC     :", ethers.formatUnits(bal, 18))
    if (bal < amount) {
      problems.push(`signer holds ${ethers.formatUnits(bal, 18)} MIC, needs ${ethers.formatUnits(amount, 18)} — ` +
        `release it from ListingReserveVault first (requestWithdraw → 7 days → executeWithdraw)`)
    }

    // Project the opening price BEFORE sending anything. Seeding is the irreversible
    // step: it fixes the price and starts the clock, and there is no second attempt.
    const effNow = await pool.effectiveUsdt()
    const projected = (effNow * 10n ** 18n) / amount
    console.log("\n── projected opening price ──")
    console.log("  effectiveUsdt      : $" + ethers.formatUnits(effNow, 18))
    console.log("  real USDT received : $" + ethers.formatUnits(await pool.reserveUsdt(), 18), "(pre-seed revenue)")
    console.log("  seed               :", ethers.formatUnits(amount, 18), "MIC")
    console.log("  → opening price    : $" + ethers.formatUnits(projected, 18))
    if (projected !== OPENING_PRICE) {
      problems.push(`projected opening price is $${ethers.formatUnits(projected, 18)}, not $0.01 — ` +
        `do NOT seed. Either the seed amount or the virtual reserve is wrong.`)
    }

    console.log("\n── plan ──")
    console.log("  1. approve", ethers.formatUnits(amount, 18), "MIC → pool")
    console.log("  2. seedMic(...)  — starts the clock, opens buying at $0.01")

    if (problems.length) { console.log("\n❌ BLOCKERS"); problems.forEach(p => console.log("   •", p)); process.exit(1) }
    if (!EXECUTE) { console.log("\n🧪 DRY-RUN — nothing sent."); return }

    await send("approve MIC → pool", mic.approve(addr, amount))
    await send("seedMic", pool.seedMic(amount))
    writeRecord({ seededAt: new Date().toISOString(), seedMicActual: amount.toString() })

    console.log("\n── verify ──")
    const spot = await pool.spotPrice()
    console.log("  isSeeded   :", await pool.isSeeded())
    console.log("  startTime  :", new Date(Number(await pool.startTime()) * 1000).toISOString())
    console.log("  reserveMic :", ethers.formatUnits(await pool.reserveMic(), 18))
    console.log("  spotPrice  : $" + ethers.formatUnits(spot, 18))
    // Print what a BUYER experiences, not just the internal reference. V6 shipped at 2×
    // because its go-live check read spotPrice — the number that was right — and never
    // once called quoteBuy.
    for (const amt of ["1", "10", "50"]) {
      const out = await pool.quoteBuy(ethers.parseUnits(amt, 18))
      const each = Number(amt) / Number(ethers.formatUnits(out, 18))
      console.log(`  quoteBuy $${amt.padStart(2)} → ${ethers.formatUnits(out, 18)} MIC  ($${each.toFixed(6)}/MIC)`)
      if (each > 0.0101 || each < 0.0100) {
        console.log(`\n⚠️  a $${amt} buy costs $${each.toFixed(6)}/MIC, expected ~$0.01003 — STOP`)
        process.exit(1)
      }
    }
    // The one number everything downstream is measured against: the MIC burn on every
    // MICE licence and the emission brake both key off this price.
    if (spot !== OPENING_PRICE) {
      console.log(`\n⚠️  opening price is $${ethers.formatUnits(spot, 18)}, expected $0.01 — STOP, do not cut over`)
      process.exit(1)
    }
    console.log("\n  ✅ opening price is exactly $0.01. Next: STAGE=cutover")
    return
  }

  // ─────────────────────────────────────────────────────────── cutover
  if (stage === "cutover") {
    // Minimal ABIs, written out rather than read from local artifacts. The local
    // contracts tree is older than the VPS one — its MICELicense.sol has no
    // setLiquidityPool at all — so getContractAt would silently build an object missing
    // the function this stage exists to call. All three selectors were verified present
    // in the live bytecode. Written this way the stage runs identically from either tree.
    const router: any = new ethers.Contract(MAINNET.RevenueRouter,
      ["function setLiquidity(address)", "function liquidity() view returns (address)"], signer)
    const mice: any = new ethers.Contract(MAINNET.MICELicense,
      ["function setLiquidityPool(address)", "function liquidityPool() view returns (address)"], signer)
    const emis: any = new ethers.Contract(MAINNET.EmissionController,
      ["function setLiquidityPool(address,uint256)", "function liquidityPool() view returns (address)"], signer)

    console.log("\n── pre-flight ──")
    if (!(await pool.isSeeded())) problems.push("pool is not seeded — run STAGE=seed first")
    const spot = await pool.spotPrice()
    console.log("  V7 spotPrice :", "$" + ethers.formatUnits(spot, 18))
    if (spot !== OPENING_PRICE) problems.push(`V7 opening price is $${ethers.formatUnits(spot, 18)}, not $0.01`)

    const D = await pool.DISTRIBUTOR_ROLE()
    const E = await pool.EMISSION_REPORTER_ROLE()
    const hasD = await pool.hasRole(D, MAINNET.RevenueRouter)
    const hasE = await pool.hasRole(E, MAINNET.EmissionController)
    console.log("  DISTRIBUTOR → router      :", hasD)
    console.log("  EMISSION_REPORTER → emis  :", hasE)
    if (!hasD) problems.push("RevenueRouter lacks DISTRIBUTOR_ROLE on V7")
    if (!hasE) problems.push("EmissionController lacks EMISSION_REPORTER_ROLE on V7")

    console.log("\n  current pointers:")
    console.log("    RevenueRouter.liquidity   :", await router.liquidity())
    console.log("    MICELicense.liquidityPool :", await mice.liquidityPool())
    console.log("    EmissionCtl.liquidityPool :", await emis.liquidityPool())

    console.log("\n── plan ──")
    console.log("  1. MICELicense.setLiquidityPool(V7)   — licence burn prices off V7")
    console.log("  2. EmissionController.setLiquidityPool(V7, $0.01)")
    console.log("     ⚠️  expected to REVERT with 'EC: already set' — its openingPrice was")
    console.log("         frozen on first use and the setter is gated on it. EmissionController")
    console.log("         stays bound to V6 permanently. Known; not a failure of this run.")
    console.log("  (RevenueRouter was moved in STAGE=router)")

    if (problems.length) { console.log("\n❌ BLOCKERS"); problems.forEach(p => console.log("   •", p)); process.exit(1) }
    if (!EXECUTE) { console.log("\n🧪 DRY-RUN — nothing sent."); return }

    if ((await router.liquidity()).toLowerCase() !== addr.toLowerCase()) {
      await send("RevenueRouter.setLiquidity", router.setLiquidity(addr))
    } else {
      console.log("  ✓ RevenueRouter already on V7 (STAGE=router)")
    }
    await send("MICELicense.setLiquidityPool", mice.setLiquidityPool(addr))
    try {
      await send("EmissionController.setLiquidityPool", emis.setLiquidityPool(addr, OPENING_PRICE))
    } catch (e: any) {
      console.log("  ⚠️  EmissionController refused:", e.shortMessage || e.message)
      console.log("      It stays bound to V6. Expected — see the plan above.")
    }
    writeRecord({ cutoverAt: new Date().toISOString() })

    console.log("\n── verify ──")
    const after = {
      router: await router.liquidity(),
      mice:   await mice.liquidityPool(),
      emis:   await emis.liquidityPool(),
    }
    let ok = true
    for (const [k, v] of Object.entries(after)) {
      const good = v.toLowerCase() === addr.toLowerCase()
      if (k !== "emis") ok &&= good          // EmissionController cannot move; not a failure
      console.log(`  ${k.padEnd(7)}: ${v} ${good ? "✓" : (k === "emis" ? "— frozen to V6, known" : "❌")}`)
    }
    if (!ok) { console.log("\n❌ a pointer did not move — investigate before announcing"); process.exit(1) }

    console.log("\n  ✅ cutover complete. V6 (%s) is now unreferenced.", MAINNET.LiquidityPoolV6)
    console.log("\n── now, in this order ──")
    console.log("  1. update packages/sdk/src/addresses.ts → LiquidityPoolV7, rebuild web + admin")
    console.log("  2. stop the keeper calling advancePhase on V6 (miningKeeper.ts)")
    console.log("  3. canary: buy $1 of MIC, confirm the wallet receives ~99.7 MIC, not ~49.8")
    console.log("  4. publish the V6 deprecation notice")
  }
}

main().catch(e => { console.error(e); process.exit(1) })
