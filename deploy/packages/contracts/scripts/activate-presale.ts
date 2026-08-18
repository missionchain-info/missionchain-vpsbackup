/**
 * Open the Pre-Sale round.
 *
 * One transaction, but it latches `everActivated` permanently: from here the Steward
 * Council can act on the unsold remainder as soon as the sale is stopped, instead of
 * waiting out the 180-day lock. That is the intended escape hatch for a round that has
 * to be abandoned, and it is the reason the flag exists — a round that never opened must
 * not be emptiable on day one.
 *
 * The menu entry stays `disabled`, so opening the sale does not put it in front of
 * anyone. Only someone who knows the /presale route can reach it.
 */
import { ethers } from "hardhat"

const PRESALE = "0xC4A6cd57DE0619daCDfD190E9A4D9682Ed78BE23"
const EXECUTE = process.env.EXECUTE === "1"

async function main() {
  const [signer] = await ethers.getSigners()
  const net = await ethers.provider.getNetwork()
  const abi = [
    "function active() view returns (bool)",
    "function everActivated() view returns (bool)",
    "function totalSold() view returns (uint256)",
    "function unsoldMIC() view returns (uint256)",
    "function hasRole(bytes32,address) view returns (bool)",
    "function setActive(bool)",
  ]
  const ps = new ethers.Contract(PRESALE, abi, signer)

  console.log("══════════════════════════════════════════════")
  console.log("  PreSale.setActive(true)")
  console.log("══════════════════════════════════════════════")
  console.log("Network :", net.chainId.toString())
  console.log("Signer  :", signer.address)
  console.log("Mode    :", EXECUTE ? "🚀 EXECUTE" : "🧪 DRY-RUN")
  console.log("")

  const [before, ever, sold, unsold, isAdmin] = await Promise.all([
    ps.active(), ps.everActivated(), ps.totalSold(), ps.unsoldMIC(),
    ps.hasRole(ethers.ZeroHash, signer.address),
  ])
  console.log("── before ──")
  console.log("  active        :", before)
  console.log("  everActivated :", ever)
  console.log("  totalSold     :", ethers.formatUnits(sold, 18), "MIC")
  console.log("  unsold        :", ethers.formatUnits(unsold, 18), "MIC")
  console.log("  signer is admin:", isAdmin)

  if (net.chainId !== 56n) { console.log("\n❌ not BSC mainnet"); process.exit(1) }
  if (!isAdmin)            { console.log("\n❌ signer is not DEFAULT_ADMIN"); process.exit(1) }
  if (before)              { console.log("\n✓ already active — nothing to do"); return }

  if (!EXECUTE) { console.log("\n🧪 DRY-RUN — set EXECUTE=1 to send."); return }

  console.log("\n── sending ──")
  const tx = await ps.setActive(true)
  console.log("  tx:", tx.hash)
  const rc = await tx.wait(1)
  console.log("  mined in block", rc?.blockNumber)

  console.log("\n── after ──")
  const [a2, e2] = await Promise.all([ps.active(), ps.everActivated()])
  console.log(`  ${a2 === true ? "✓" : "✗"} active        = ${a2}`)
  console.log(`  ${e2 === true ? "✓" : "✗"} everActivated = ${e2}  (latched, permanent)`)
  console.log("\n  The menu entry is still disabled — the round is reachable only at /presale.")
}
main().catch((e) => { console.error(e); process.exit(1) })
