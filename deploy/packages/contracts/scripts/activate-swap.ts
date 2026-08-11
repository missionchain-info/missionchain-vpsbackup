/**
 * Bring the SWAP pool to life — the second half of the MICE · MINING · SWAP deploy.
 *
 * `deploy-mice-mining.ts` leaves the pool dormant on purpose: it holds no MIC, quotes no
 * price, refuses every trade and every inbound revenue split, and its clock has not
 * started. This script is what starts it, and it does the three things that must happen
 * together:
 *
 *   1. seed 50,000,000 MIC        → sets the opening price at exactly $0.01
 *   2. start the clock            → TWAP history and the 30-day sell gate begin here
 *   3. repoint RevenueRouter      → the 40% liquidity slice moves to the new pool
 *
 * Step 3 is deliberately last and deliberately not in the deploy script. Price is reserve
 * over MIC; USDT arriving before the MIC would open the pool above the published $0.01.
 *
 * Run with EXECUTE=1 to broadcast. Without it, everything is checked and nothing is sent.
 */
import { ethers } from "hardhat"
import fs from "fs"
import path from "path"

const MAINNET = {
  MIC:           "0xf27ec0c311728b923b22828002c992c799326182",
  RevenueRouter: "0xf86b0cF9ce21250429b522Ed62a5B6b549539672",
}

/** Filled from the deploy output — deployments/mice-mining-*.json */
const POOL = process.env.POOL || ""

const POOL_MIC = ethers.parseUnits("50000000", 18)
const OPENING_PRICE = ethers.parseUnits("0.01", 18)

function findPoolAddress(): string {
  if (POOL) return POOL
  const dir = path.join(__dirname, "../deployments")
  if (!fs.existsSync(dir)) return ""
  const files = fs.readdirSync(dir).filter(f => f.startsWith("mice-mining-")).sort()
  if (files.length === 0) return ""
  const latest = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), "utf8"))
  return latest.LiquidityPoolV6 || ""
}

async function main() {
  const EXECUTE = process.env.EXECUTE === "1"
  const [deployer] = await ethers.getSigners()

  console.log("═".repeat(78))
  console.log("ACTIVATE SWAP" + (EXECUTE ? "  [EXECUTE]" : "  [DRY-RUN]"))
  console.log("═".repeat(78))

  const poolAddr = findPoolAddress()
  const problems: string[] = []

  if (!poolAddr) {
    console.log("❌ No pool address. Pass POOL=0x… or run the deploy first.")
    process.exit(1)
  }
  console.log("Pool    :", poolAddr)
  console.log("Deployer:", deployer.address)

  const pool: any = await ethers.getContractAt("LiquidityPoolV6", poolAddr)
  const mic = await ethers.getContractAt("MICToken", MAINNET.MIC)
  const router: any = await ethers.getContractAt("RevenueRouter", MAINNET.RevenueRouter)

  console.log("\n── pre-flight ──")

  // Bail before any contract call. Every read below assumes a real pool, and a wrong
  // address would otherwise surface as an ethers decode error mid-run — the least useful
  // thing to be reading while standing over a mainnet activation.
  if ((await ethers.provider.getCode(poolAddr)) === "0x") {
    console.log(`\n[X] no contract code at ${poolAddr} on this network - wrong address, or wrong --network`)
    process.exit(1)
  }

  const alreadySeeded = await pool.isSeeded()
  console.log("  pool seeded  :", alreadySeeded)
  if (alreadySeeded) {
    problems.push("pool is already seeded — activation has already run; re-seeding would move the opening price")
  }

  const micBal = await mic.balanceOf(deployer.address)
  console.log("  deployer MIC :", ethers.formatUnits(micBal, 18))
  if (micBal < POOL_MIC) {
    problems.push(
      `deployer holds ${ethers.formatUnits(micBal, 18)} MIC, needs ${ethers.formatUnits(POOL_MIC, 18)} — ` +
      `run executeWithdraw(1) on ListingReserveVault first (unlocks 2026-08-12 18:02 UTC)`,
    )
  }

  // The seed is a plain transfer, so it is subject to the same vesting gate as any other.
  // MIC withdrawn from ListingReserveVault carries no schedule; MIC from a vault that
  // creates one would arrive locked and this would revert half way through.
  try {
    const lm = await pool.mic()
    void lm
  } catch { /* ignore */ }

  const bnb = await ethers.provider.getBalance(deployer.address)
  console.log("  deployer BNB :", ethers.formatEther(bnb))
  if (bnb < ethers.parseEther("0.01")) problems.push("BNB below 0.01 — top up")

  const currentLiquidity = await router.liquidity()
  console.log("  router → liquidity:", currentLiquidity)
  if (currentLiquidity.toLowerCase() === poolAddr.toLowerCase()) {
    console.log("    (already repointed — that step will be skipped)")
  }

  const DISTRIBUTOR = await pool.DISTRIBUTOR_ROLE()
  const routerHasRole = await pool.hasRole(DISTRIBUTOR, MAINNET.RevenueRouter)
  console.log("  pool.DISTRIBUTOR → router:", routerHasRole)
  if (!routerHasRole) problems.push("RevenueRouter lacks DISTRIBUTOR_ROLE on the pool — the deploy script grants it")

  console.log("\n── plan ──")
  console.log("  1. approve 50,000,000 MIC → pool")
  console.log("  2. seedMic(50,000,000)      → opening price $0.01, clock starts")
  console.log("  3. RevenueRouter.setLiquidity(pool)")

  if (problems.length > 0) {
    console.log("\n❌ BLOCKERS")
    for (const p of problems) console.log("   •", p)
    if (EXECUTE) process.exit(1)
  }

  if (!EXECUTE) {
    console.log("\n🧪 DRY-RUN complete — nothing sent. Set EXECUTE=1 to broadcast.")
    return
  }

  const R = async (label: string, fn: Promise<any>) => {
    const tx = await fn; await tx.wait(); console.log("  ✓", label)
  }

  console.log("\n── execute ──")
  await R("approve 50M MIC → pool", mic.approve(poolAddr, POOL_MIC))
  await R("seedMic(50,000,000)", pool.seedMic(POOL_MIC))

  if (currentLiquidity.toLowerCase() !== poolAddr.toLowerCase()) {
    await R("RevenueRouter.setLiquidity(pool)", router.setLiquidity(poolAddr))
  }

  console.log("\n── verify ──")
  const spot = await pool.spotPrice()
  const seeded = await pool.isSeeded()
  const started = await pool.startTime()
  console.log("  isSeeded    :", seeded)
  console.log("  startTime   :", new Date(Number(started) * 1000).toISOString())
  console.log("  spotPrice   : $" + ethers.formatUnits(spot, 18))
  console.log("  poolAgeDays :", (await pool.poolAgeDays()).toString())
  console.log("  router → liq:", await router.liquidity())

  // The opening price is the one number everything else is measured against — the MIC
  // burn on every MICE purchase, and the emission brake. If it is not $0.01 the seed
  // amount or the virtual reserve is wrong, and that must be caught now, not in a week.
  if (spot !== OPENING_PRICE) {
    console.log(`\n⚠️  opening price is $${ethers.formatUnits(spot, 18)}, expected $0.01 — STOP and investigate`)
    process.exit(1)
  }

  console.log("\n✅ SWAP is live.")
  console.log("\n── now, in this order ──")
  console.log("  1. set KEEPER_PK in /opt/missionchain/deploy/.env and restart mc-api")
  console.log("     (docker compose build mc-api && up -d — a restart alone reboots the old image)")
  console.log("  2. confirm the keeper logged 'miningKeeper started'")
  console.log("  3. canary: buy one $100 MICE licence, activate it, check the burn and the 6-way split")
  console.log("  4. only then enable the mice / mining / swap menu entries")
  console.log("\n  Sells stay closed for 30 days from now:", new Date((Number(started) + 30 * 86400) * 1000).toISOString())
}

main().catch(e => { console.error(e); process.exit(1) })
