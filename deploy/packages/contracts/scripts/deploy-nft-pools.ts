/**
 * Replace the two push-based NFT reward pools with claim-based ones.
 *
 * The pools deployed on 2026-08-10 pay out only through
 * `distribute(recipients[], amounts[])` — an operator pushing MIC to a list. There is
 * nothing behind a claim button, the platform pays gas per recipient, a payout is capped
 * by what fits in one transaction, and nothing happens at all on a day nobody runs it.
 *
 * `NftRewardPoolV2` accrues by the second against tier weight and waits to be claimed.
 *
 * Replacing them now is free: both hold zero MIC and have never distributed, and
 * `EmissionController` exposes setters for each, so nothing else has to move.
 *
 * ## One thing the EmissionController cannot do
 *
 * `distributeDaily` mints into these pools but never announces it — the notify wiring was
 * only ever added for the miner pool. A streaming pool that is funded without being told
 * leaves `rewardRate` at zero and the MIC sits there earning nobody anything.
 *
 * EmissionController is already deployed and that path is fixed in its bytecode, so the
 * keeper closes it: after each daily distribution it reads the amounts out of the
 * `DailyDistributed` event and calls `notifyReward` on both pools. That is why the keeper
 * wallet is granted EMISSION_ROLE here.
 */
import { ethers } from "hardhat"
import fs from "fs"
import path from "path"

const MAINNET = {
  MIC:            "0xf27ec0c311728b923b22828002c992c799326182",
  CommunityNFTv2: "0x28263C00C371A6DE9592E2477f2813408F337E96",
  Emission:       "0x89135fAbcA6a129Be6f326489405011110D2ed51",
  OldCommunity:   "0x75DF32Cb543cf7f7B1cC0143C1321E05C29b1166",
  OldMfp:         "0x2A60F8AE99C26b5a789688e53228767B6EFFCAEd",
  WeeklyPool:     "0x187b221C47b976b39E40F46470f0252f4194B676",
  MonthlyPool:    "0x8ce8c0fAe3C9E5FE54b49e3654EA9B9ef862CefC",
}

const KEEPER = "0x2D5bd60Eefb96a8Fc4c67C4321502b3c347e8054"

/** One MFP pass weighs ×10, matching MFP_WEIGHT_BPS in the reward engine. */
const MFP_WEIGHT = 100_000

async function main() {
  const EXECUTE = process.env.EXECUTE === "1"
  const [deployer] = await ethers.getSigners()
  const admin = deployer.address

  console.log("═".repeat(78))
  console.log("NFT reward pools → claim-based" + (EXECUTE ? "  [EXECUTE]" : "  [DRY-RUN]"))
  console.log("═".repeat(78))
  console.log("Deployer:", deployer.address)

  const problems: string[] = []
  const mic = await ethers.getContractAt("MICToken", MAINNET.MIC)

  console.log("\n── pre-flight ──")

  // Replacing a pool that already holds MIC would strand it: the old contract pays out
  // only through `distribute`, and nothing would ever call that again.
  for (const [name, addr] of [["old Community", MAINNET.OldCommunity], ["old MFP", MAINNET.OldMfp]] as const) {
    const bal = await mic.balanceOf(addr)
    console.log(`  ${name.padEnd(14)} holds ${ethers.formatUnits(bal, 18)} MIC`)
    if (bal > 0n) problems.push(`${name} pool holds ${ethers.formatUnits(bal, 18)} MIC — drain it before replacing`)
  }

  const bnb = await ethers.provider.getBalance(deployer.address)
  console.log("  deployer BNB  :", ethers.formatEther(bnb))
  if (bnb < ethers.parseEther("0.01")) problems.push("BNB below 0.01 — top up")

  const emission = await ethers.getContractAt("EmissionController", MAINNET.Emission)
  console.log("  EC → community:", await (emission as any).communityNFTPool())
  console.log("  EC → mfp      :", await (emission as any).mfpRewardPool())

  console.log("\n── plan ──")
  console.log("  1. NftRewardPoolV2  Community  (weight = tier multiplier, read from CommunityNFTv2)")
  console.log("  2. NftRewardPoolV2  MFP        (flat weight ×10, never expires)")
  console.log("  3. EMISSION_ROLE → keeper on both — it notifies after each distributeDaily")
  console.log("  4. EmissionController.setCommunityNFTPool / setMfpRewardPool")
  console.log("  5. CREDITOR_ROLE → keeper on the Weekly and Monthly USDT pools")

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
  const F = await ethers.getContractFactory("NftRewardPoolV2")

  const community: any = await F.deploy(MAINNET.MIC, MAINNET.CommunityNFTv2, 0, admin)
  await community.waitForDeployment()
  const communityAddr = await community.getAddress()
  console.log("  ✓ Community pool", communityAddr)

  const mfp: any = await F.deploy(MAINNET.MIC, ethers.ZeroAddress, MFP_WEIGHT, admin)
  await mfp.waitForDeployment()
  const mfpAddr = await mfp.getAddress()
  console.log("  ✓ MFP pool      ", mfpAddr)

  console.log("\n── wire ──")
  const EMISSION_ROLE = await community.EMISSION_ROLE()
  await R("Community.EMISSION → keeper", community.grantRole(EMISSION_ROLE, KEEPER))
  await R("MFP.EMISSION → keeper", mfp.grantRole(EMISSION_ROLE, KEEPER))

  await R("EmissionController.setCommunityNFTPool", (emission as any).setCommunityNFTPool(communityAddr))
  await R("EmissionController.setMfpRewardPool", (emission as any).setMfpRewardPool(mfpAddr))

  // The USDT side: the keeper credits closed weekly and monthly periods on its own.
  // CREDITOR_ROLE here reaches only these two pools — it is a different contract from
  // ClaimRewardsV2, so the Group Volume funds stay out of the keeper's reach entirely.
  const usdtPoolAbi = ["function CREDITOR_ROLE() view returns (bytes32)", "function grantRole(bytes32,address)"]
  for (const [name, addr] of [["Weekly", MAINNET.WeeklyPool], ["Monthly", MAINNET.MonthlyPool]] as const) {
    const pool = new ethers.Contract(addr, usdtPoolAbi, (await ethers.getSigners())[0])
    await R(`${name}.CREDITOR → keeper`, pool.grantRole(await pool.CREDITOR_ROLE(), KEEPER))
  }

  const out = {
    CommunityNFTRewardPool: communityAddr,
    MFPRewardPool: mfpAddr,
    replaced: { community: MAINNET.OldCommunity, mfp: MAINNET.OldMfp },
    keeper: KEEPER,
  }
  const file = path.join(__dirname, `../deployments/nft-pools-v2.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(out, null, 2))

  console.log("\n── verify ──")
  console.log("  EC → community:", await (emission as any).communityNFTPool())
  console.log("  EC → mfp      :", await (emission as any).mfpRewardPool())
  console.log("  Community.nft :", await community.nft())
  console.log("  MFP flatWeight:", (await mfp.flatWeight()).toString())

  console.log("\n✅ done — addresses written to", file)
  console.log("\n── next ──")
  console.log("  • verify both on BSCScan")
  console.log("  • update packages/sdk/src/addresses.ts, rebuild mc-app and mc-api")
  console.log("  • the old pools keep no MIC and are now unreferenced — nothing to migrate")
}

main().catch(e => { console.error(e); process.exit(1) })
