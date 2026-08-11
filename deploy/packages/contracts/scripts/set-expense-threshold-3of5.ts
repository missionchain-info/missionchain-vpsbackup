/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Align management-spend voting with DAOGovernor: 75% → 60% (3 of 5)
 * ─────────────────────────────────────────────────────────────────────────────
 * The system was running two different governance rules at once.
 *
 *   DAOGovernor           BTC_QUORUM = 3, a fixed count      → 3 of 5
 *   ManagementBonusPoolV3 thresholdBps = 7500, a ratio        → 4 of 5
 *   ReservedExpensesPoolV3 threshold   = 7500, a ratio        → 4 of 5
 *
 * `approvals * 10000 >= activeCouncil * threshold`, so at five seats 75% needs four
 * votes: 4×10000 ≥ 5×7500, while 3×10000 = 30000 < 37500. Every document, including all
 * five White Papers, says 3 of 5 — the Owner's decision of 2026-08-07. These two pools
 * never got the message.
 *
 * 6000 makes the ratio land exactly on three at five seats: 3×10000 = 30000 ≥ 5×6000.
 *
 * ⚠️ A ratio and a fixed count only agree at the size they were tuned for. Below five
 * seats they drift apart — at three seats 60% needs two votes while DAOGovernor still
 * needs three. Seat the full Council before relying on either.
 *
 * SAFETY: dry-run by default; only EXECUTE=1 sends transactions.
 *   Review:   npx hardhat run scripts/set-expense-threshold-3of5.ts --network bsc
 *   Execute:  EXECUTE=1 npx hardhat run scripts/set-expense-threshold-3of5.ts --network bsc
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ethers } from "hardhat"

const TARGET_BPS = 6000

const POOLS = [
  {
    name: "ManagementBonusPoolV3",
    address: "0x2bfA50146C01d6c4BFA4A2550385988C2619f033",
    getter: "thresholdBps",
    // require(newBps > 0 && newBps <= 10_000)
    min: 1, max: 10_000,
  },
  {
    name: "ReservedExpensesPoolV3",
    address: "0xe04519547F051AE4388FcdE571EA2301dD9e3495",
    getter: "threshold", // NOT thresholdBps — the two contracts name it differently
    // require(newBps >= 5000 && newBps <= 10000)
    min: 5_000, max: 10_000,
  },
]

const EXECUTE = process.env.EXECUTE === "1"

/** Votes needed at a given council size for a ratio threshold. */
function votesNeeded(seats: number, bps: number): number {
  for (let k = 1; k <= seats; k++) if (k * 10_000 >= seats * bps) return k
  return seats
}

async function main() {
  const [signer] = await ethers.getSigners()
  const net = await ethers.provider.getNetwork()

  console.log("══════════════════════════════════════════════════════════")
  console.log("  Management-spend threshold → 3 of 5")
  console.log("══════════════════════════════════════════════════════════")
  console.log("Network :", net.chainId.toString())
  console.log("Signer  :", signer.address)
  console.log("Mode    :", EXECUTE ? "🚀 EXECUTE (broadcasts txs)" : "🧪 DRY-RUN (plan only, no txs)")
  console.log("")

  const problems: string[] = []
  if (net.chainId !== 56n) problems.push(`Not BSC mainnet (chainId ${net.chainId}). Use --network bsc.`)

  console.log("── Votes needed at each council size ──")
  console.log("  seats   at 7500 (now)   at 6000 (after)   DAOGovernor")
  for (const seats of [3, 4, 5]) {
    const now = votesNeeded(seats, 7_500)
    const after = votesNeeded(seats, TARGET_BPS)
    const flag = after === 3 ? "" : "   ← differs from the fixed quorum of 3"
    console.log(`   ${seats}          ${now}                ${after}               3${flag}`)
  }
  console.log("")

  const plan: Array<{ name: string; address: string; from: bigint }> = []

  for (const p of POOLS) {
    const c = new ethers.Contract(
      p.address,
      [`function ${p.getter}() view returns (uint16)`, "function setThreshold(uint16)", "function owner() view returns (address)"],
      signer,
    )
    let current: bigint, owner: string
    try {
      current = await c[p.getter]()
      owner = await c.owner()
    } catch (e: any) {
      problems.push(`${p.name}: could not read state — ${e.shortMessage || e.message}`)
      continue
    }

    const isOwner = owner.toLowerCase() === signer.address.toLowerCase()
    console.log(`── ${p.name}`)
    console.log(`   ${p.address}`)
    console.log(`   ${p.getter} : ${current}  →  ${TARGET_BPS}`)
    console.log(`   owner       : ${isOwner ? "✓ signer" : "✗ " + owner}`)

    if (!isOwner) problems.push(`${p.name}: signer is not owner — setThreshold is onlyOwner.`)
    if (TARGET_BPS < p.min || TARGET_BPS > p.max) {
      problems.push(`${p.name}: ${TARGET_BPS} is outside its accepted range [${p.min}, ${p.max}].`)
    }
    if (current === BigInt(TARGET_BPS)) {
      console.log("   already at target — nothing to do")
      continue
    }
    plan.push({ name: p.name, address: p.address, from: current })
    console.log("")
  }

  if (problems.length) {
    console.log("⚠️  BLOCKERS:")
    problems.forEach(x => console.log("   ✗", x))
  } else {
    console.log("✓ pre-flight OK")
  }

  if (!EXECUTE) {
    console.log(`\n── PLAN — ${plan.length} transaction(s) ──`)
    plan.forEach((p, i) => console.log(`  ${i + 1}  ${p.name}.setThreshold(${TARGET_BPS})   [${p.from} → ${TARGET_BPS}]`))
    if (!plan.length) console.log("  (nothing to change)")
    console.log("\n🧪 DRY-RUN complete — no transactions sent. Set EXECUTE=1 to broadcast.")
    return
  }
  if (problems.length) { console.log("\n❌ Aborting: fix blockers above."); process.exit(1) }

  console.log("\n── Executing ──")
  for (const p of plan) {
    const c = new ethers.Contract(p.address, ["function setThreshold(uint16)"], signer)
    const tx = await c.setThreshold(TARGET_BPS)
    await tx.wait()
    console.log(`  ✓ ${p.name} → ${TARGET_BPS}   tx ${tx.hash}`)
  }

  console.log("\n── Verify ──")
  let ok = true
  for (const p of POOLS) {
    const c = new ethers.Contract(p.address, [`function ${p.getter}() view returns (uint16)`], ethers.provider)
    const v = await c[p.getter]()
    const good = v === BigInt(TARGET_BPS)
    if (!good) ok = false
    console.log(`  ${good ? "✓" : "✗"} ${p.name}.${p.getter} = ${v}`)
  }
  console.log(ok
    ? "\n✅ Both pools now pass at 3 of 5, matching DAOGovernor."
    : "\n⚠️  A pool did not take the new value — check above.")
}

main().catch((e) => { console.error(e); process.exit(1) })
