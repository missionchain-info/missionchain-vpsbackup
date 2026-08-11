/**
 * Open the SEED round.
 *
 * The whitelist stays on: `whitelistRequired` is untouched, so only wallets already
 * cleared can buy. Opening the round without that gate would put MIC at $0.0025 in front
 * of anyone while the Pre-Sale asks $0.005 for the same token.
 */
import { ethers } from "hardhat"

const SEED = "0x5216c5C69FB899CC3De8Aa94165363153B5B589d"
const EXECUTE = process.env.EXECUTE === "1"

async function main() {
  const [signer] = await ethers.getSigners()
  const net = await ethers.provider.getNetwork()
  const abi = [
    "function active() view returns (bool)",
    "function whitelistRequired() view returns (bool)",
    "function whitelistedCount() view returns (uint256)",
    "function totalSold() view returns (uint256)",
    "function hasRole(bytes32,address) view returns (bool)",
    "function setActive(bool)",
  ]
  const s = new ethers.Contract(SEED, abi, signer)

  console.log("══════════════════════════════════════════")
  console.log("  SeedSaleV9.setActive(true)")
  console.log("══════════════════════════════════════════")
  console.log("Network:", net.chainId.toString(), "· Signer:", signer.address)
  console.log("Mode   :", EXECUTE ? "🚀 EXECUTE" : "🧪 DRY-RUN", "\n")

  const [active, gated, cleared, sold, admin] = await Promise.all([
    s.active(), s.whitelistRequired(), s.whitelistedCount(), s.totalSold(),
    s.hasRole(ethers.ZeroHash, signer.address),
  ])
  console.log("── before ──")
  console.log("  active            :", active)
  console.log("  whitelistRequired :", gated, gated ? "✓ gate stays on" : "⚠ OPEN TO EVERYONE")
  console.log("  wallets cleared   :", cleared.toString())
  console.log("  totalSold         :", ethers.formatUnits(sold, 18), "MIC")
  console.log("  signer is admin   :", admin)

  if (net.chainId !== 56n) { console.log("\n❌ not BSC mainnet"); process.exit(1) }
  if (!admin)              { console.log("\n❌ signer is not DEFAULT_ADMIN"); process.exit(1) }
  if (!gated)              { console.log("\n❌ whitelistRequired is false — refusing to open an ungated SEED round"); process.exit(1) }
  if (active)              { console.log("\n✓ already active"); return }
  if (cleared === 0n)      { console.log("\n⚠ no wallets are cleared — the round will open but nobody can buy yet") }

  if (!EXECUTE) { console.log("\n🧪 DRY-RUN — set EXECUTE=1 to send."); return }

  console.log("\n── sending ──")
  const tx = await s.setActive(true)
  console.log("  tx:", tx.hash)
  const rc = await tx.wait(1)
  console.log("  block", rc?.blockNumber)

  const [a2, g2] = await Promise.all([s.active(), s.whitelistRequired()])
  console.log("\n── after ──")
  console.log(`  ${a2 ? "✓" : "✗"} active            = ${a2}`)
  console.log(`  ${g2 ? "✓" : "✗"} whitelistRequired = ${g2}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
