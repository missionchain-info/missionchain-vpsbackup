/**
 * Deploy the three contracts that unblock MFP trading, Community NFT trading, and
 * member-claimed rank bonuses.
 *
 *   1. P2PEscrowNFT (MFP)        — replaces P2PEscrowMFP 0xcff2…4b8B
 *   2. P2PEscrowNFT (Community)  — new; the collection has never had a market
 *   3. RankBonusClaim            — the member presses Mint, not an admin
 *
 * Run with EXECUTE=1 to broadcast. Without it every precondition is read from chain and
 * nothing is sent.
 *
 * ## What this does NOT do
 *
 * It does not touch the old P2PEscrowMFP. That contract holds nothing — `nextOrderId` is
 * 0 because no listing could ever be created — so there is nothing to migrate and nothing
 * to rescue. It is left alone rather than paused, because pausing a market nobody can
 * reach only spends gas.
 *
 * It does not enable anything in the DApp. The markets stay hidden until the Owner flips
 * them in admin → P2P → Tradable Assets. Deploying and opening are separate acts.
 */
import { ethers } from "hardhat"
import fs from "fs"
import path from "path"

const MAINNET = {
  USDT:            "0x55d398326f99059fF775485246999027B3197955",
  MFPNFT:          "0xAE6F32A6fdf80F5e54ba85441386dBA6a381f565",
  CommunityNFTv2:  "0x28263C00C371A6DE9592E2477f2813408F337E96",
  ClaimRewardsV2:  "0x1F38FD97a656d80bF873ca2B9262D9EB337E6866",
  TreasuryManager: "0x1ed5C848D1244a618Bd95Ff92d4f8C2356d3a42F",
  OldEscrowMFP:    "0xcff25169c783B84eFBa746eF4A51271764f24b8B",
}

/** Who may record that a wallet reached a rank.
 *
 *  Comma-separated, because the Owner chose to hold the role alongside the keeper: the
 *  keeper records ranks automatically each day, and the Owner wallet is the way back in
 *  if the keeper is down or its key has to be rotated. AWARDER_ROLE only records an
 *  entitlement — it moves no money and mints nothing by itself.
 *
 *  Defaults to the deployer when unset. */
const KEEPER = process.env.KEEPER || ""

const line = "═".repeat(78)

async function main() {
  const EXECUTE = process.env.EXECUTE === "1"
  const [deployer] = await ethers.getSigners()
  const net = await ethers.provider.getNetwork()

  console.log(line)
  console.log("DEPLOY  P2PEscrowNFT ×2  +  RankBonusClaim" + (EXECUTE ? "   [EXECUTE]" : "   [DRY-RUN]"))
  console.log(line)
  console.log("network :", net.name, "chainId", net.chainId.toString())
  console.log("deployer:", deployer.address)
  console.log("BNB     :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)))

  const problems: string[] = []
  const notes: string[] = []

  // ── pre-flight ──────────────────────────────────────────────────────────
  console.log("\n── pre-flight ──")

  if (net.chainId !== 56n) problems.push(`wrong network: chainId ${net.chainId}, expected 56`)

  // The check that seven incidents needed. Read from the live token, not from a constant.
  const usdt = new ethers.Contract(MAINNET.USDT, [
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
  ], ethers.provider)
  const dec = Number(await usdt.decimals())
  console.log(`  USDT ${await usdt.symbol()} decimals:`, dec)
  if (dec !== 18) problems.push(`USDT reports ${dec} decimals — every price in this batch assumes 18`)

  // Both collections must be real ERC-721s; the escrow constructor refuses anything else.
  const IID_721 = "0x80ac58cd"
  const IID_2981 = "0x2a55205a"
  for (const [name, addr] of [["MFPNFT", MAINNET.MFPNFT], ["CommunityNFTv2", MAINNET.CommunityNFTv2]] as const) {
    const c = new ethers.Contract(addr, [
      "function supportsInterface(bytes4) view returns (bool)",
    ], ethers.provider)
    const is721 = await c.supportsInterface(IID_721).catch(() => false)
    const is2981 = await c.supportsInterface(IID_2981).catch(() => false)
    console.log(`  ${name.padEnd(15)} ERC-721 ${is721}   ERC-2981 ${is2981}`)
    if (!is721) problems.push(`${name} does not answer the ERC-721 interface`)
    if (name === "CommunityNFTv2" && is2981) {
      notes.push("CommunityNFTv2 now answers ERC-2981 — it did not on 2026-08-12. Check who receives the royalty before opening that market.")
    }
  }

  // The old escrow, stated rather than assumed: this is why it is being replaced.
  const old = new ethers.Contract(MAINNET.OldEscrowMFP, [
    "function MAX_PRICE_USDT() view returns (uint256)",
    "function nextOrderId() view returns (uint256)",
  ], ethers.provider)
  const oldMax = await old.MAX_PRICE_USDT().catch(() => null)
  const oldCount = await old.nextOrderId().catch(() => null)
  if (oldMax !== null) {
    console.log(`  old escrow MAX_PRICE_USDT: ${oldMax} = $${ethers.formatUnits(oldMax, 18)}`)
    console.log(`  old escrow nextOrderId   : ${oldCount}`)
    if (oldCount !== null && oldCount > 0n) {
      problems.push(`old escrow holds ${oldCount} order(s) — it was believed empty; investigate before replacing`)
    }
  }

  // RankBonusClaim needs CREDITOR_ROLE on ClaimRewardsV2, which only an admin can grant.
  const cr = new ethers.Contract(MAINNET.ClaimRewardsV2, [
    "function CREDITOR_ROLE() view returns (bytes32)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function hasRole(bytes32,address) view returns (bool)",
  ], ethers.provider)
  const creditor = await cr.CREDITOR_ROLE()
  const adminRole = await cr.DEFAULT_ADMIN_ROLE()
  const deployerIsAdmin = await cr.hasRole(adminRole, deployer.address)
  console.log("  deployer is ClaimRewardsV2 admin:", deployerIsAdmin)
  if (!deployerIsAdmin) {
    problems.push("deployer does not hold DEFAULT_ADMIN_ROLE on ClaimRewardsV2 — it cannot grant CREDITOR_ROLE, so rank claims would revert")
  }

  // And ClaimRewardsV2 must itself be able to mint.
  const cnft = new ethers.Contract(MAINNET.CommunityNFTv2, [
    "function MINTER_ROLE() view returns (bytes32)",
    "function hasRole(bytes32,address) view returns (bool)",
  ], ethers.provider)
  const minter = await cnft.MINTER_ROLE()
  const crCanMint = await cnft.hasRole(minter, MAINNET.ClaimRewardsV2)
  console.log("  ClaimRewardsV2 holds MINTER_ROLE on CommunityNFTv2:", crCanMint)
  if (!crCanMint) {
    problems.push("ClaimRewardsV2 cannot mint Community NFTs — grant MINTER_ROLE first, or every rank claim reverts")
  }

  const awarders = (KEEPER ? KEEPER.split(",") : [deployer.address])
    .map((a) => a.trim())
    .filter(Boolean)
  // De-duplicate so passing the deployer alongside the keeper does not send a second,
  // identical grant that costs gas and proves nothing.
  const uniqueAwarders = [...new Map(awarders.map((a) => [a.toLowerCase(), a])).values()]
  for (const a of uniqueAwarders) {
    if (!ethers.isAddress(a)) problems.push(`KEEPER entry is not an address: ${a}`)
  }
  if (uniqueAwarders.length === 0) problems.push("no AWARDER_ROLE holder given")
  if (!KEEPER) {
    notes.push(`AWARDER_ROLE will go to the deployer (${deployer.address}). Pass KEEPER=0x…,0x… to name the holders explicitly.`)
  }

  const bnb = await ethers.provider.getBalance(deployer.address)
  if (bnb < ethers.parseEther("0.03")) problems.push("BNB below 0.03 — three deployments plus role grants need more")

  // ── plan ────────────────────────────────────────────────────────────────
  console.log("\n── plan ──")
  console.log("  1. P2PEscrowNFT(usdt, MFPNFT,         TreasuryManager, deployer)")
  console.log("  2. P2PEscrowNFT(usdt, CommunityNFTv2, TreasuryManager, deployer)")
  console.log("  3. RankBonusClaim(ClaimRewardsV2, deployer)")
  console.log("  4. ClaimRewardsV2.grantRole(CREDITOR_ROLE, RankBonusClaim)")
  uniqueAwarders.forEach((a, i) => {
    console.log(`  ${5 + i}. RankBonusClaim.grantRole(AWARDER_ROLE, ${a})`)
  })
  console.log("\n  defaults on each escrow: fee 150 bps · price $1 … $1,000,000 (settable)")
  console.log("  neither market is opened here — that is a switch in admin → P2P")

  if (notes.length) {
    console.log("\n── notes ──")
    for (const n of notes) console.log("   •", n)
  }

  if (problems.length) {
    console.log("\n❌ BLOCKERS")
    for (const p of problems) console.log("   •", p)
    if (EXECUTE) process.exit(1)
  }

  if (!EXECUTE) {
    console.log("\n🧪 DRY-RUN complete — nothing sent. Set EXECUTE=1 to broadcast.")
    return
  }

  // ── execute ─────────────────────────────────────────────────────────────
  console.log("\n── execute ──")
  const F = await ethers.getContractFactory("P2PEscrowNFT")

  const mfpEscrow = await F.deploy(MAINNET.USDT, MAINNET.MFPNFT, MAINNET.TreasuryManager, deployer.address)
  await mfpEscrow.waitForDeployment()
  console.log("  ✓ P2PEscrowNFT (MFP)      ", await mfpEscrow.getAddress())

  const comEscrow = await F.deploy(MAINNET.USDT, MAINNET.CommunityNFTv2, MAINNET.TreasuryManager, deployer.address)
  await comEscrow.waitForDeployment()
  console.log("  ✓ P2PEscrowNFT (Community)", await comEscrow.getAddress())

  const R = await ethers.getContractFactory("RankBonusClaim")
  const rbc = await R.deploy(MAINNET.ClaimRewardsV2, deployer.address)
  await rbc.waitForDeployment()
  console.log("  ✓ RankBonusClaim          ", await rbc.getAddress())

  const crW = new ethers.Contract(MAINNET.ClaimRewardsV2, [
    "function grantRole(bytes32,address)",
  ], deployer)
  await (await crW.grantRole(creditor, await rbc.getAddress())).wait()
  console.log("  ✓ CREDITOR_ROLE → RankBonusClaim")

  const awarder = await (rbc as any).AWARDER_ROLE()
  for (const a of uniqueAwarders) {
    await (await (rbc as any).grantRole(awarder, a)).wait()
    console.log("  ✓ AWARDER_ROLE  →", a)
  }

  // ── verify, from chain ──────────────────────────────────────────────────
  console.log("\n── verify ──")
  for (const [name, e] of [["MFP", mfpEscrow], ["Community", comEscrow]] as const) {
    const c = e as any
    console.log(`  ${name.padEnd(10)} royaltyAware=${await c.royaltyAware()}` +
      ` min=$${ethers.formatUnits(await c.minPriceUsdt(), 18)}` +
      ` max=$${ethers.formatUnits(await c.maxPriceUsdt(), 18)}` +
      ` fee=${await c.feeBps()}bps paused=${await c.paused()}`)
  }
  const cr2 = new ethers.Contract(MAINNET.ClaimRewardsV2, [
    "function hasRole(bytes32,address) view returns (bool)",
  ], ethers.provider)
  console.log("  RankBonusClaim has CREDITOR_ROLE:", await cr2.hasRole(creditor, await rbc.getAddress()))
  for (const a of uniqueAwarders) {
    console.log(`  AWARDER_ROLE ${a}:`, await (rbc as any).hasRole(awarder, a))
  }

  const out = {
    deployedAt: new Date().toISOString(),
    chainId: net.chainId.toString(),
    deployer: deployer.address,
    P2PEscrowNFT_MFP: await mfpEscrow.getAddress(),
    P2PEscrowNFT_Community: await comEscrow.getAddress(),
    RankBonusClaim: await rbc.getAddress(),
    awarders: uniqueAwarders,
    replaces: { P2PEscrowMFP: MAINNET.OldEscrowMFP },
  }
  const dir = path.join(__dirname, "../deployments")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `p2p-nft-rank-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(out, null, 2))
  console.log("\n  written:", file)

  console.log("\n── still to do, by hand ──")
  console.log("  1. put the two escrow addresses in packages/sdk/src/addresses.ts")
  console.log("  2. verify all three on BSCScan")
  console.log("  3. point the DApp's MFP market at the new escrow")
  console.log("  4. open the markets in admin → P2P → Tradable Assets")
}

main().catch((e) => { console.error(e); process.exit(1) })
