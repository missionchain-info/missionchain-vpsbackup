/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MISSION CHAIN — SeedSaleV8 → SeedSaleV9 migration (whitelist enforced)
 * ─────────────────────────────────────────────────────────────────────────────
 * SeedSaleV8 0xD855076f200dFa2526303c2242E49DFcB3635B50 was deployed 2026-08-08 15:55
 * and never activated. It fixed V7's 6-decimal pricing, but was built during a short
 * window when the SEED round was to be open to everyone, so it carries no whitelist at
 * all. Activating it would sell MIC at $0.0025 to anyone while the Pre-Sale asks $0.005
 * for the same token — $1,000 buys 400,000 MIC there against 200,000 here — and the
 * 315,000,000 MIC in PreSale 0xC4A6…BE23 would never move.
 *
 * V9 is V8 plus a whitelist that `buyPackage` actually reads. `totalSold` on V8 is 0, so
 * nothing is stranded and no buyer state has to be carried.
 *
 * This script moves the round to SeedSaleV9 in 11 transactions:
 *   1  rescue the MIC out of V8
 *   1  deploy V9, carrying oldInvestorsGranted forward
 *   4  grant V9 the roles V8 held
 *   1  fund V9 with exactly micRequired()
 *   4  revoke those roles from V8
 *
 * Deliberately kept OUT of deploy-presale-phase1.ts. The two batches share nothing but
 * a deployer, and entangling them means a failure in one leaves the other half-wired.
 *
 * SAFETY: dry-run by default; only EXECUTE=1 sends transactions.
 *   Review:   npx hardhat run scripts/migrate-seedsale-v9.ts --network bsc
 *   Execute:  EXECUTE=1 npx hardhat run scripts/migrate-seedsale-v9.ts --network bsc
 *
 * V9 is left with active = false AND whitelistRequired = true, so even once the round is
 * switched on nobody can buy until wallets are added from the admin console.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ethers } from "hardhat"
import fs from "fs"
import path from "path"

const MAINNET = {
  USDT:          "0x55d398326f99059fF775485246999027B3197955",
  MIC:           "0xf27ec0c311728b923b22828002c992c799326182",
  LockManager:   "0x6bE58BCe62f526E7751e121CDBa1eb22873471A0",
  MFPNFT:        "0xAE6F32A6fdf80F5e54ba85441386dBA6a381f565",
  SeedBudgetV5c: "0x33ec0A97029adde1A7e0f78E3B8f414Ec56527ef",
  SeedSaleV8:    "0xD855076f200dFa2526303c2242E49DFcB3635B50", // deployed, never activated, being replaced
}

/**
 * Role ids are taken from the LIVE contracts, never from local source — local MFPNFT.sol
 * has already drifted (its MINTER_ROLE getter does not exist on the deployed contract).
 * Note LockManager's schedule role hashes the string "SCHEDULE_CREATOR" while the getter
 * is named SCHEDULE_CREATOR_ROLE; reading the getter avoids guessing either way.
 */
const ROLE_WIRING = [
  { contract: "LockManager",   address: MAINNET.LockManager,   getter: "SCHEDULE_CREATOR_ROLE", why: "createSchedule on each purchase" },
  { contract: "LockManager",   address: MAINNET.LockManager,   getter: "ADMIN_GRANTER_ROLE",    why: "createScheduleWithStart for Old Investor grants" },
  { contract: "MFPNFT",        address: MAINNET.MFPNFT,        getter: "SEED_GRANTER_ROLE",     why: "autoGrantFromSeed mints the MFP allowance" },
  { contract: "SeedBudgetV5c", address: MAINNET.SeedBudgetV5c, getter: "CALLER_ROLE",           why: "receiveAndDistribute takes the USDT" },
]

const EXECUTE = process.env.EXECUTE === "1"
const ROLE_ABI = ["function hasRole(bytes32,address) view returns (bool)", "function grantRole(bytes32,address)", "function revokeRole(bytes32,address)"]

async function main() {
  const [deployer] = await ethers.getSigners()
  const net = await ethers.provider.getNetwork()
  const admin = deployer.address

  console.log("══════════════════════════════════════════════════════════")
  console.log("  SeedSaleV8 → SeedSaleV9  (whitelist enforced)")
  console.log("══════════════════════════════════════════════════════════")
  console.log("Network :", net.chainId.toString())
  console.log("Deployer:", admin)
  console.log("BNB     :", ethers.formatEther(await ethers.provider.getBalance(admin)))
  console.log("Mode    :", EXECUTE ? "🚀 EXECUTE (broadcasts txs)" : "🧪 DRY-RUN (plan only, no txs)")
  console.log("")

  const problems: string[] = []
  if (net.chainId !== 56n) problems.push(`Not BSC mainnet (chainId ${net.chainId}). Use --network bsc.`)

  // ── Read the contract being replaced ──────────────────────────────────────
  const oldAbi = [
    "function active() view returns (bool)",
    "function totalSold() view returns (uint256)",
    "function oldInvestorsGranted() view returns (uint256)",
    "function ALLOCATION() view returns (uint256)",
    "function OLD_INVESTORS_ALLOCATION() view returns (uint256)",
    "function hasRole(bytes32,address) view returns (bool)",
    "function rescueToken(address,address,uint256)",
  ]
  const old = new ethers.Contract(MAINNET.SeedSaleV8, oldAbi, deployer)
  const mic = await ethers.getContractAt("IERC20", MAINNET.MIC)

  const [oldActive, oldSold, oldGranted, oldAlloc, oldPool, oldMic] = await Promise.all([
    old.active(), old.totalSold(), old.oldInvestorsGranted(),
    old.ALLOCATION(), old.OLD_INVESTORS_ALLOCATION(), mic.balanceOf(MAINNET.SeedSaleV8),
  ])

  console.log("── SeedSaleV8 (being replaced) ──")
  console.log("  active             :", oldActive, oldActive ? "⛔ HALT IT FIRST" : "✓ halted")
  console.log("  totalSold          :", ethers.formatUnits(oldSold, 18), "MIC")
  console.log("  oldInvestorsGranted:", ethers.formatUnits(oldGranted, 18), "MIC  ← carried forward")
  console.log("  MIC held           :", ethers.formatUnits(oldMic, 18))

  // The migration only reconciles if V8 holds exactly what it still owes. A mismatch
  // means someone moved MIC in or out, and the funding figure below would be wrong.
  const owed = (oldAlloc - oldSold) + (oldPool - oldGranted)
  console.log("  MIC still owed     :", ethers.formatUnits(owed, 18))
  if (owed !== oldMic) {
    problems.push(`V9 holds ${ethers.formatUnits(oldMic, 18)} MIC but owes ${ethers.formatUnits(owed, 18)} — reconcile before migrating.`)
  }
  if (oldActive) problems.push("V8 is still active. Halt it before migrating, or a buyer can drain it mid-run.")
  if (oldSold !== 0n) problems.push(`V8 totalSold is ${ethers.formatUnits(oldSold, 18)}, not 0 — buyers exist and this plan does not carry their state.`)

  // ── Admin rights needed for every step ────────────────────────────────────
  const isAdmin = async (addr: string) => {
    const c = new ethers.Contract(addr, ROLE_ABI, ethers.provider)
    return c.hasRole(ethers.ZeroHash, admin)
  }
  console.log("\n── Admin rights ──")
  for (const [label, addr] of [
    ["SeedSaleV8", MAINNET.SeedSaleV8], ["LockManager", MAINNET.LockManager],
    ["MFPNFT", MAINNET.MFPNFT], ["SeedBudgetV5c", MAINNET.SeedBudgetV5c],
  ] as const) {
    const ok = await isAdmin(addr)
    console.log(`  ${label.padEnd(14)} ${ok ? "✓ deployer is DEFAULT_ADMIN" : "✗ NOT admin"}`)
    if (!ok) problems.push(`Deployer is not DEFAULT_ADMIN of ${label} — cannot complete the migration.`)
  }

  // ── The scale mistake this whole migration exists to fix ──────────────────
  const usdtMeta = await ethers.getContractAt("IERC20Metadata", MAINNET.USDT)
  const dec = await usdtMeta.decimals()
  console.log("\nUSDT decimals        :", dec.toString(), Number(dec) === 18 ? "✓" : "✗ EXPECTED 18")
  if (Number(dec) !== 18) problems.push(`USDT reports ${dec} decimals; V8 prices assume 18 and its constructor will revert.`)

  const MIN_BNB = ethers.parseEther("0.03")
  const bnb = await ethers.provider.getBalance(admin)
  if (bnb < MIN_BNB) problems.push(`BNB ${ethers.formatEther(bnb)} is below the ${ethers.formatEther(MIN_BNB)} floor for an 11-transaction run.`)

  // ── Resolve role ids off the live contracts ───────────────────────────────
  console.log("\n── Roles to move from V8 to V9 ──")
  const roles: Array<{ label: string; address: string; id: string; heldByOld: boolean }> = []
  for (const r of ROLE_WIRING) {
    const c = new ethers.Contract(r.address, [`function ${r.getter}() view returns (bytes32)`, ...ROLE_ABI], deployer)
    try {
      const id: string = await c[r.getter]()
      const heldByOld: boolean = await c.hasRole(id, MAINNET.SeedSaleV8)
      roles.push({ label: `${r.contract}.${r.getter}`, address: r.address, id, heldByOld })
      console.log(`  ${(r.contract + "." + r.getter).padEnd(38)} ${heldByOld ? "V8 holds ✓" : "V8 does NOT hold ⚠"}   ${r.why}`)
      if (!heldByOld) problems.push(`V8 does not hold ${r.contract}.${r.getter} — the wiring is not what this script assumes.`)
    } catch (e: any) {
      problems.push(`Could not read ${r.contract}.${r.getter}(): ${e.shortMessage || e.message}`)
    }
  }

  console.log("\n── Pre-flight ──")
  if (problems.length) {
    console.log("⚠️  BLOCKERS (fix before EXECUTE):")
    problems.forEach(p => console.log("   ✗", p))
  } else {
    console.log("✓ pre-flight OK")
  }

  if (!EXECUTE) {
    console.log("\n── PLAN (dry-run) ──")
    console.log(`  1  V8.rescueToken(MIC → deployer, ${ethers.formatUnits(oldMic, 18)})`)
    console.log(`  2  deploy SeedSaleV9(initialOldInvestorsGranted = ${ethers.formatUnits(oldGranted, 18)})`)
    roles.forEach((r, i) => console.log(`  ${3 + i}  grant  ${r.label} → V9`))
    console.log(`  ${3 + roles.length}  transfer MIC → V9 (exactly micRequired())`)
    roles.forEach((r, i) => console.log(`  ${4 + roles.length + i}  revoke ${r.label} from V8`))
    console.log(`\n  Total ${2 + roles.length * 2 + 1} transactions. V9 ships with active = false AND whitelistRequired = true.`)
    console.log("\n🧪 DRY-RUN complete — no transactions sent. Set EXECUTE=1 to broadcast.")
    return
  }
  if (problems.length) { console.log("\n❌ Aborting: fix blockers above."); process.exit(1) }

  const R = async (label: string, fn: Promise<any>) => { const tx = await fn; await tx.wait(); console.log("  ✓", label) }

  // ── 1. Empty V8 ───────────────────────────────────────────────────────────
  console.log("\n── 1. Rescue MIC out of V8 ──")
  await R(`rescueToken ${ethers.formatUnits(oldMic, 18)} MIC → deployer`,
    old.rescueToken(MAINNET.MIC, admin, oldMic))

  const afterRescue = await mic.balanceOf(MAINNET.SeedSaleV8)
  if (afterRescue !== 0n) { console.log(`❌ V8 still holds ${ethers.formatUnits(afterRescue, 18)} MIC — stopping.`); process.exit(1) }

  // ── 2. Deploy V8 ──────────────────────────────────────────────────────────
  console.log("\n── 2. Deploy SeedSaleV9 ──")
  const V8 = await ethers.getContractFactory("SeedSaleV9")
  const v9 = await V8.deploy(
    MAINNET.USDT, MAINNET.MIC, MAINNET.LockManager,
    MAINNET.MFPNFT, MAINNET.SeedBudgetV5c, admin,
    oldGranted,
  )
  await v9.waitForDeployment()
  const v9Addr = await v9.getAddress()
  console.log("  ✓ SeedSaleV9", v9Addr)

  // ── 3. Grant V8 the roles ─────────────────────────────────────────────────
  console.log("\n── 3. Grant roles to V9 ──")
  for (const r of roles) {
    const c = new ethers.Contract(r.address, ROLE_ABI, deployer)
    await R(`${r.label} → V9`, c.grantRole(r.id, v9Addr))
  }

  // ── 4. Fund ───────────────────────────────────────────────────────────────
  console.log("\n── 4. Fund V9 ──")
  const need = await (v9 as any).micRequired()
  await R(`transfer ${ethers.formatUnits(need, 18)} MIC → V9`, mic.transfer(v9Addr, need))

  // ── 5. Revoke from V8 ─────────────────────────────────────────────────────
  // V8 keeps DEFAULT_ADMIN so the Owner can still rescue anything that lands on it, but
  // it must not be able to mint MFP allowances or write vesting schedules ever again.
  console.log("\n── 5. Revoke roles from V8 ──")
  for (const r of roles) {
    const c = new ethers.Contract(r.address, ROLE_ABI, deployer)
    await R(`${r.label} revoked from V8`, c.revokeRole(r.id, MAINNET.SeedSaleV8))
  }

  // ── Verify ────────────────────────────────────────────────────────────────
  console.log("\n── Verify ──")
  const checks: Array<[string, boolean]> = []
  checks.push(["V8 holds 0 MIC", (await mic.balanceOf(MAINNET.SeedSaleV8)) === 0n])
  checks.push([`V9 holds ${ethers.formatUnits(need, 18)} MIC`, (await mic.balanceOf(v9Addr)) === need])
  checks.push(["V9 oldInvestorsGranted carried over", (await (v9 as any).oldInvestorsGranted()) === oldGranted])
  checks.push(["V9 active = false", (await (v9 as any).active()) === false])
  checks.push(["V9 whitelistRequired = true", (await (v9 as any).whitelistRequired()) === true])
  checks.push(["V9 whitelist empty at deploy", (await (v9 as any).whitelistedCount()) === 0n])
  for (const r of roles) {
    const c = new ethers.Contract(r.address, ROLE_ABI, ethers.provider)
    checks.push([`${r.label}: V9 yes / V8 no`, (await c.hasRole(r.id, v9Addr)) && !(await c.hasRole(r.id, MAINNET.SeedSaleV8))])
  }
  let allOk = true
  for (const [label, ok] of checks) { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) allOk = false }

  const file = path.resolve(__dirname, `../deployments/seedsale-v9-mainnet.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({
    chainId: 56, admin,
    SeedSaleV9: v9Addr,
    replaces: MAINNET.SeedSaleV8,
    oldInvestorsGrantedCarriedOver: oldGranted.toString(),
    micFunded: need.toString(),
  }, null, 2))
  console.log("\n✓ addresses saved →", file)
  console.log("\n── paste into packages/sdk/src/addresses.ts (bsc) ──")
  console.log(`    SeedSaleV9:            "${v9Addr}",`)
  console.log(`    SeedSale:              "${v9Addr}",   // alias → V9`)
  console.log("── end paste ──")
  console.log("The DApp resolves `seed` as SeedSaleV8 first, so it switches over on that edit alone.")

  console.log("\n══════════════════════════════════════════════════════════")
  console.log(allOk ? "  ✅ MIGRATION COMPLETE — SeedSaleV9 is NOT live yet." : "  ⚠️  MIGRATION FINISHED WITH FAILED CHECKS — review above.")
  console.log("  Manual final steps (deliberate, off this script):")
  console.log("   1. Verify SeedSaleV9 on BSCScan.")
  console.log("   2. Whitelist the partner wallets (admin → Rounds → SEED).\n   3. SeedSaleV9.setActive(true)  ← the round still needs the whitelist to let anyone in.")
  console.log("   4. Update packages/sdk/src/addresses.ts and the admin/app config.")
  console.log("  Never call setActive(true) on SeedSaleV7 or SeedSaleV8 again.")
  console.log("══════════════════════════════════════════════════════════")
}

main().catch((e) => { console.error(e); process.exit(1) })
