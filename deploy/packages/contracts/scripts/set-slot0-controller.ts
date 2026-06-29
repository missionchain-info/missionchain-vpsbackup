/**
 * Phase 2c-pivot — wire Distribution slot[0] to Distributor flow
 *
 * Sets slotController[0] = deployer wallet so Owner can call
 * `seedBudget.release(SLOT_DISTRIBUTION, distributor, gross)` from the
 * admin "Approve & Pay" Payment Request button.
 *
 * Also syncs on-chain fee config with DB SystemConfig.payout_fee_*
 * so contract auto-deduct matches what admin UI displays.
 *
 * Pre-state (May 2):
 *   slotController[0] = 0x0 (unset)
 *   feeBps = 0, feeReceiver = deployer
 * DB current:
 *   payout_fee_bps = 500 (5%)
 *   payout_fee_receiver = 0x4c041c635321b1e91c4c9c557d53e9f6ff1d1d90
 *
 * Run:
 *   PRIVATE_KEY=$(grep '^DEPLOYER_PK=' /opt/missionchain/deploy/.env | cut -d= -f2-) \
 *     npx hardhat run scripts/set-slot0-controller.ts --network bscTestnet
 */
import { ethers } from "hardhat"

const SEED_BUDGET_V5B = "0xA2Ba0302b6fdfcBF3517F658ee74e2C22A033Ba5"
const SLOT_DISTRIBUTION = 0

// DB SystemConfig values (verified May 2 via psql) — keep in sync with what
// /admin/distributors/payout-config currently returns.
const DB_FEE_BPS = 500
const DB_FEE_RECEIVER = "0x4c041c635321b1e91c4c9c557d53e9f6ff1d1d90"

async function main() {
  const [signer] = await ethers.getSigners()
  console.log("Deployer:", signer.address)
  console.log("tBNB:    ", ethers.formatEther(await ethers.provider.getBalance(signer.address)))

  const sb = await ethers.getContractAt("SeedBudgetV5b", SEED_BUDGET_V5B, signer)

  console.log("\n── BEFORE ──")
  console.log("slotController[0] =", await sb.slotController(SLOT_DISTRIBUTION))
  console.log("feeBps            =", (await sb.feeBps()).toString())
  console.log("feeReceiver       =", await sb.feeReceiver())

  console.log("\n[1/2] setSlotController(0, deployer)…")
  const tx1 = await sb.setSlotController(SLOT_DISTRIBUTION, signer.address)
  await tx1.wait()
  console.log("    tx:", tx1.hash)

  console.log(`[2/2] setFee(${DB_FEE_BPS}, ${DB_FEE_RECEIVER})…`)
  const tx2 = await sb.setFee(DB_FEE_BPS, DB_FEE_RECEIVER)
  await tx2.wait()
  console.log("    tx:", tx2.hash)

  console.log("\n── AFTER ──")
  console.log("slotController[0] =", await sb.slotController(SLOT_DISTRIBUTION))
  console.log("feeBps            =", (await sb.feeBps()).toString())
  console.log("feeReceiver       =", await sb.feeReceiver())
  console.log("\n✓ Slot[0] wired. Approve & Pay can now call release(0, distributor, gross).")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
