/**
 * Redeploy MICELicense with a bootstrap price, and EmissionController with it.
 *
 * ## Why both
 *
 * MICE prices the MIC half of every licence from the SWAP pool, so while the pool is
 * unseeded it quotes nothing and every purchase reverts with "MICE: no price". The fix is
 * a bootstrap price used only until the pool is live — and it is not an approximation:
 * spot at the seed is the virtual reserve over the MIC seeded ($500,000 / 50,000,000 =
 * $0.01) and `twap7d` on a pool of age zero returns spot, so the last purchase before
 * seeding and the first after it cost exactly the same. There is no step to trade against.
 *
 * `MICELicense.liquidityPool` had no setter and `EmissionController.miceLicense` is
 * `immutable`, so changing how MICE prices anything drags the controller along with it.
 * One missing setter is the whole reason this costs two contracts and a MINTER_ROLE
 * handover. The new MICELicense carries `setLiquidityPool` so it never costs that again.
 *
 * ## The dangerous part
 *
 * EmissionController is the only holder of `MINTER_ROLE` on MIC. This grants it to the new
 * one and revokes it from the old, in that order, and then re-checks that exactly one
 * address holds it. Leaving both would mean two contracts could mint; revoking first would
 * mean a window where nothing could.
 *
 * Nothing has been sold — `totalMinted` is zero — so there is no licence state to migrate.
 * This is the cheapest moment this change will ever be possible.
 */
import { ethers } from "hardhat"
import fs from "fs"
import path from "path"

const A = {
  USDT:        "0x55d398326f99059fF775485246999027B3197955",
  MIC:         "0xf27ec0c311728b923b22828002c992c799326182",
  Registry:    "0x2a8C0c5c7414fD4f879ba34883652f306403f0f9",
  Router:      "0xf86b0cF9ce21250429b522Ed62a5B6b549539672",
  DAO:         "0xDCD65DC97b0A147BeCf542E22a5C218C006231cC",
  Pool:        "0xf6AB7103d1072416366D34Ce5E8A41074feCC98e",
  MiningPool:  "0x9178292E960cb17380dd329866e725e33200e04f",
  Staking:     "0x4eae6376501E975CbF207473E3277417495fd3fE",
  CNftPool:    "0xae26BA0f1c639beA93e5a4dD9313F5765A29Ee5a",
  MfpPool:     "0xFb79deC4F0CDe13A667018e567dD636255D61d6d",
  OldMice:     "0xfC9A80C260871A6d33Df6ECb6D95Ba1Fd14033de",
  OldEmission: "0x89135fAbcA6a129Be6f326489405011110D2ed51",
}

const KEEPER = "0x2D5bd60Eefb96a8Fc4c67C4321502b3c347e8054"
const BOOTSTRAP = ethers.parseUnits("0.01", 18)

async function main() {
  const EXECUTE = process.env.EXECUTE === "1"
  const [deployer] = await ethers.getSigners()
  const admin = deployer.address

  console.log("═".repeat(78))
  console.log("MICELicense + EmissionController → bootstrap price" + (EXECUTE ? "  [EXECUTE]" : "  [DRY-RUN]"))
  console.log("═".repeat(78))
  console.log("Deployer:", deployer.address)

  const problems: string[] = []
  const mic = await ethers.getContractAt("MICToken", A.MIC)
  const MINTER = await mic.MINTER_ROLE()

  console.log("\n── pre-flight ──")

  // A sold licence would have to be migrated, and there is no migration path. This must
  // stay zero or the whole approach is wrong.
  const oldMice = await ethers.getContractAt("MICELicense", A.OldMice)
  const sold = await (oldMice as any).totalMinted()
  console.log("  licences sold so far:", sold.toString())
  if (sold > 0n) problems.push(`${sold} licences already minted — they would be stranded on the old contract`)

  const bnb = await ethers.provider.getBalance(deployer.address)
  console.log("  deployer BNB        :", ethers.formatEther(bnb))
  if (bnb < ethers.parseEther("0.02")) problems.push("BNB below 0.02 — top up before running")

  console.log("  old EC holds MINTER :", await mic.hasRole(MINTER, A.OldEmission))

  console.log("\n── plan ──")
  console.log("  1. MICELicense        with bootstrapPrice $0.01 and a setLiquidityPool setter")
  console.log("  2. EmissionController pointing at the new MICELicense")
  console.log("  3. re-wire 10 links from the old pair to the new")
  console.log("  4. MINTER_ROLE → new EC, then REVOKE from old EC")
  console.log("  5. revoke the old MICELicense's roles on registry, router and MiningPool")

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

  console.log("\n── deploy ──")
  const mice: any = await (await ethers.getContractFactory("MICELicense")).deploy(
    A.USDT, A.MIC, A.Registry, A.Router, admin, A.Pool, BOOTSTRAP,
  )
  await mice.waitForDeployment()
  const miceAddr = await mice.getAddress()
  console.log("  ✓ MICELicense       ", miceAddr)

  const emission: any = await (await ethers.getContractFactory("EmissionController")).deploy(
    A.MIC, miceAddr, A.MiningPool, A.Staking, A.DAO, A.CNftPool, A.MfpPool, admin,
  )
  await emission.waitForDeployment()
  const emissionAddr = await emission.getAddress()
  console.log("  ✓ EmissionController", emissionAddr)

  console.log("\n── wire the new pair ──")
  const registry: any = await ethers.getContractAt("ReferralRegistry", A.Registry)
  const router: any = await ethers.getContractAt("RevenueRouter", A.Router)
  const mining: any = await ethers.getContractAt("MiningPool", A.MiningPool)
  const pool: any = await ethers.getContractAt("LiquidityPoolV6", A.Pool)

  await R("ReferralRegistry.CALLER → MICE", registry.grantRole(await registry.CALLER_ROLE(), miceAddr))
  await R("RevenueRouter.DISTRIBUTOR → MICE", router.grantRole(await router.DISTRIBUTOR_ROLE(), miceAddr))
  await R("MiningPool.LICENCE → MICE", mining.grantRole(await mining.LICENCE_ROLE(), miceAddr))
  await R("MiningPool.setLicenceContract", mining.setLicenceContract(miceAddr))
  await R("MICELicense.setMiningPool", mice.setMiningPool(A.MiningPool))

  await R("MiningPool.EMISSION → new EC", mining.grantRole(await mining.EMISSION_ROLE(), emissionAddr))
  await R("Pool.EMISSION_REPORTER → new EC", pool.grantRole(await pool.EMISSION_REPORTER_ROLE(), emissionAddr))
  await R("EC.setLiquidityPool(pool, $0.01)", emission.setLiquidityPool(A.Pool, BOOTSTRAP))

  // The two NFT pools already grant EMISSION_ROLE to the keeper, which is what notifies
  // them; the controller only needs to know where to mint.
  console.log("  (NFT pools already point at the keeper for notify — nothing to change)")

  console.log("\n── MINTER_ROLE handover ──")
  await R("MICToken.MINTER → new EC", mic.grantRole(MINTER, emissionAddr))
  await R("MICToken.MINTER revoked from old EC", mic.revokeRole(MINTER, A.OldEmission))

  console.log("\n── retire the old MICELicense ──")
  // A dead contract keeping the right to write to the referral ledger and to move revenue
  // is exactly the kind of leftover that becomes someone's finding a year later.
  await R("ReferralRegistry.CALLER revoked from old MICE",
    registry.revokeRole(await registry.CALLER_ROLE(), A.OldMice))
  await R("RevenueRouter.DISTRIBUTOR revoked from old MICE",
    router.revokeRole(await router.DISTRIBUTOR_ROLE(), A.OldMice))
  await R("MiningPool.LICENCE revoked from old MICE",
    mining.revokeRole(await mining.LICENCE_ROLE(), A.OldMice))

  console.log("\n── verify ──")
  console.log("  MICE.bootstrapPrice   : $" + ethers.formatEther(await mice.bootstrapPrice()))
  console.log("  MICE.miningPool       :", await mice.miningPool())
  console.log("  Mining.licenceContract:", await mining.licenceContract())
  console.log("  EC.miceLicense        :", await emission.miceLicense())
  console.log("  EC.liquidityPool      :", await emission.liquidityPool())
  console.log("  new EC holds MINTER   :", await mic.hasRole(MINTER, emissionAddr))
  console.log("  old EC holds MINTER   :", await mic.hasRole(MINTER, A.OldEmission))

  const quote = await (mice as any).quoteMicRequired(1n)
  console.log("  quoteMicRequired(1)   :", ethers.formatEther(quote), "MIC  (expect 5,000 at $0.01)")
  if (quote !== ethers.parseEther("5000")) {
    console.log("\n⚠️  quote is not 5,000 MIC — STOP and investigate before opening sales")
    process.exit(1)
  }

  const out = { MICELicense: miceAddr, EmissionController: emissionAddr, retired: { mice: A.OldMice, emission: A.OldEmission } }
  const file = path.join(__dirname, `../deployments/mice-bootstrap.json`)
  fs.writeFileSync(file, JSON.stringify(out, null, 2))
  console.log("\n✅ done —", file)
}

main().catch(e => { console.error(e); process.exit(1) })
