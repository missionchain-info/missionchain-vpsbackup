/**
 * FORK-TEST — PreSale Phase 1 on a BSC mainnet fork.
 * Deploys the full V2 set against REAL mainnet MIC / USDT / LockManager / TreasuryManager,
 * runs a real purchase, and asserts the 6-way gross split + vesting lock + NFT + claim.
 *
 * Run:  npx hardhat run scripts/forktest-presale-phase1.ts
 * (Forks BSC at latest via public dataseed using hardhat_reset — no real tx, no BNB.)
 */
import { ethers, network } from "hardhat"

const MAINNET = {
  USDT:            "0x55d398326f99059fF775485246999027B3197955",
  MIC:             "0xf27ec0c311728b923b22828002c992c799326182",
  LockManager:     "0x6bE58BCe62f526E7751e121CDBa1eb22873471A0",
  TreasuryManager: "0x1ed5C848D1244a618Bd95Ff92d4f8C2356d3a42F",
}
const OWNER = "0xD32e666381b56f979D60C57831838f05F33AD6c2"          // deployer + admin (holds 315M MIC)
const USDT_WHALE = "0xF977814e90dA44bFA03b6295A0616a897441aceC"      // Binance 8 (holds huge USDT)
const MGMT6 = Array(6).fill(OWNER)

const e6 = (n: number) => BigInt(Math.round(n * 1e6))
let PASS = 0, FAIL = 0
function check(label: string, got: bigint, want: bigint, tol: bigint = 0n) {
  const d = got > want ? got - want : want - got
  if (d <= tol) { console.log(`  ✓ ${label}: ${got}`); PASS++ }
  else { console.log(`  ✗ ${label}: got ${got} want ${want} (Δ${d})`); FAIL++ }
}

async function impersonate(addr: string) {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [addr] })
  await network.provider.request({ method: "hardhat_setBalance", params: [addr, "0x3635C9ADC5DEA00000"] }) // 1000 BNB
  return await ethers.getSigner(addr)
}

async function main() {
  console.log("── BSC mainnet fork (config-driven, FORK_BSC=1) ──")
  const micCode = await ethers.provider.getCode(MAINNET.MIC)
  if (micCode === "0x" || micCode.length < 4) throw new Error("Not forking BSC (MIC has no code). Run with FORK_BSC=1.")
  console.log(`  ✓ fork active @ block ${await ethers.provider.getBlockNumber()} (MIC code ${micCode.length} bytes)`)

  const deployer = await impersonate(OWNER)
  const usdt = await ethers.getContractAt("IERC20", MAINNET.USDT)
  const mic  = await ethers.getContractAt("IERC20", MAINNET.MIC)

  const micStart = await mic.balanceOf(OWNER)
  console.log("Deployer MIC:", ethers.formatUnits(micStart, 18))

  // ═══ DEPLOY (as OWNER) ═══
  console.log("── Deploy ──")
  const D = async (name: string, args: any[]) => {
    const F = (await ethers.getContractFactory(name)).connect(deployer)
    const c = await F.deploy(...args); await c.waitForDeployment(); return c
  }
  const admin = OWNER
  const cnft     = await D("CommunityNFTv2", [admin])
  const registry = await D("ReferralRegistry", [MAINNET.USDT, admin])
  const claim    = await D("ClaimRewardsV2", [MAINNET.USDT, await cnft.getAddress(), admin])
  const weekly   = await D("NFTRewardPool", [MAINNET.USDT, admin, "Weekly Growth", 9091])
  const monthly  = await D("NFTRewardPool", [MAINNET.USDT, admin, "Monthly Community", 9375])
  const lucky    = await D("LuckyDraw", [MAINNET.USDT, admin])
  const distrib  = await D("RewardDistributorV2", [MAINNET.USDT, await claim.getAddress(), await weekly.getAddress(), await monthly.getAddress(), await lucky.getAddress(), admin])
  const staking  = await D("ListingReserve", [MAINNET.USDT, admin])
  const mgmt     = await D("ManagementPool", [MAINNET.USDT, MGMT6, admin])
  const liq      = await D("LiquidityPool", [MAINNET.USDT, MAINNET.MIC, admin])
  const router   = await D("RevenueRouter", [MAINNET.USDT, await registry.getAddress(), await distrib.getAddress(), await mgmt.getAddress(), MAINNET.TreasuryManager, await staking.getAddress(), await liq.getAddress(), admin])
  const presale  = await D("PreSale", [MAINNET.USDT, MAINNET.MIC, MAINNET.LockManager, await cnft.getAddress(), await registry.getAddress(), await router.getAddress(), admin])

  // ═══ WIRE (as OWNER / admin) ═══
  console.log("── Wire roles ──")
  const R = (c: any) => c.connect(deployer)
  const ROLE = async (c: any, n: string) => (c as any)[n]()
  await (await R(cnft).grantRole(await ROLE(cnft, "MINTER_ROLE"), await presale.getAddress())).wait()
  await (await R(cnft).grantRole(await ROLE(cnft, "MINTER_ROLE"), await claim.getAddress())).wait()
  await (await R(registry).grantRole(await ROLE(registry, "CALLER_ROLE"), await presale.getAddress())).wait()
  await (await R(registry).setIncentivePool(await claim.getAddress())).wait()
  await (await R(claim).grantRole(await ROLE(claim, "DISTRIBUTOR_ROLE"), await distrib.getAddress())).wait()
  await (await R(claim).grantRole(await ROLE(claim, "OVERFLOW_ROLE"), await registry.getAddress())).wait()
  await (await R(claim).grantRole(await ROLE(claim, "CREDITOR_ROLE"), OWNER)).wait()
  for (const p of [weekly, monthly]) {
    await (await R(p).grantRole(await ROLE(p, "DISTRIBUTOR_ROLE"), await distrib.getAddress())).wait()
    await (await R(p).grantRole(await ROLE(p, "CREDITOR_ROLE"), OWNER)).wait()
  }
  await (await R(lucky).grantRole(await ROLE(lucky, "DISTRIBUTOR_ROLE"), await distrib.getAddress())).wait()
  await (await R(lucky).grantRole(await ROLE(lucky, "CREDITOR_ROLE"), OWNER)).wait()
  await (await R(distrib).grantRole(await ROLE(distrib, "DISTRIBUTOR_ROLE"), await router.getAddress())).wait()
  await (await R(staking).grantRole(await ROLE(staking, "DISTRIBUTOR_ROLE"), await router.getAddress())).wait()
  await (await R(mgmt).grantRole(await ROLE(mgmt, "DISTRIBUTOR_ROLE"), await router.getAddress())).wait()
  await (await R(liq).grantRole(await ROLE(liq, "DISTRIBUTOR_ROLE"), await router.getAddress())).wait()
  await (await R(liq).grantRole(await ROLE(liq, "DEPOSITOR_ROLE"), OWNER)).wait()
  await (await R(router).grantRole(await ROLE(router, "DISTRIBUTOR_ROLE"), await presale.getAddress())).wait()
  // Existing mainnet contracts — OWNER is admin (verified)
  const treasury = await ethers.getContractAt("TreasuryManager", MAINNET.TreasuryManager)
  await (await R(treasury).grantRole(await ROLE(treasury, "DISTRIBUTOR_ROLE"), await router.getAddress())).wait()
  const lockMgr = await ethers.getContractAt("LockManager", MAINNET.LockManager)
  await (await R(lockMgr).grantRole(await ROLE(lockMgr, "SCHEDULE_CREATOR_ROLE"), await presale.getAddress())).wait()
  console.log("  ✓ all grants OK (incl. real TreasuryManager + LockManager)")

  // ═══ FUND + ACTIVATE ═══
  console.log("── Fund PreSale 315M + activate ──")
  await (await R(mic).transfer(await presale.getAddress(), micStart)).wait()
  check("PreSale MIC balance", await mic.balanceOf(await presale.getAddress()), micStart)
  await (await R(presale).setActive(true)).wait()

  // ═══ SET UP REFERRAL TREE  buyer → f1 → f2 ═══
  const [_, f1signer, f2signer, buyerSigner] = await ethers.getSigners()
  const f1 = f1signer.address, f2 = f2signer.address, buyer = buyerSigner.address
  await (await R(registry).setReferrer(f1, f2)).wait()
  await (await R(registry).setReferrer(buyer, f1)).wait()

  // ═══ GIVE BUYER USDT (from whale) ═══
  const whale = await impersonate(USDT_WHALE)
  const AMT = e6(1000) // $1000 → package 1 (Builder NFT)
  await (await usdt.connect(whale).transfer(buyer, AMT)).wait()

  // snapshot pre-buy balances of pools
  const bal = async (a: string) => usdt.balanceOf(a)
  const treasuryBefore = await bal(MAINNET.TreasuryManager)

  // ═══ BUY (package 1 = $1000, Builder NFT) ═══
  console.log("── Buy $1000 (package 1) ──")
  await (await usdt.connect(buyerSigner).approve(await presale.getAddress(), AMT)).wait()
  await (await presale.connect(buyerSigner).buy(AMT, 1)).wait()

  // ═══ ASSERT 6-WAY GROSS SPLIT ═══
  console.log("── Assert splits (of $1000 gross) ──")
  check("ClaimRewardsV2 (10.5%)", await bal(await claim.getAddress()), e6(105))
  check("Weekly (5.5%)",          await bal(await weekly.getAddress()), e6(55))
  check("Monthly (8%)",           await bal(await monthly.getAddress()), e6(80))
  check("LuckyDraw (1%)",         await bal(await lucky.getAddress()), e6(10))
  check("ManagementPool (7.5%)",  await bal(await mgmt.getAddress()), e6(75))
  check("Treasury Δ (12.5%)",     (await bal(MAINNET.TreasuryManager)) - treasuryBefore, e6(125))
  check("ListingReserve (5%)",    await bal(await staking.getAddress()), e6(50))
  check("LiquidityPool (40%)",    await bal(await liq.getAddress()), e6(400))
  check("Router drained",         await bal(await router.getAddress()), 0n)
  check("Distributor drained",    await bal(await distrib.getAddress()), 0n)
  check("Registry drained",       await bal(await registry.getAddress()), 0n)
  check("F1 referral (7%)",       await bal(f1), e6(70))
  check("F2 referral (3%)",       await bal(f2), e6(30))

  // ═══ ASSERT MIC + VESTING LOCK + NFT ═══
  console.log("── Assert buyer MIC / lock / NFT ──")
  const micBuyer = await mic.balanceOf(buyer)
  check("Buyer MIC (200k)", micBuyer, ethers.parseUnits("200000", 18))
  const locked = await lockMgr.lockedOf(buyer)
  check("Buyer MIC locked (200k)", locked, ethers.parseUnits("200000", 18))
  const nftBal = await cnft.balanceOf(buyer)
  check("Buyer owns 1 Community NFT", nftBal, 1n)

  // ═══ ASSERT CLAIM (GV) ═══
  console.log("── Assert claim: creditGV → claimGV ──")
  const gvAmt = e6(50)
  await (await R(claim).creditGV([f1], [gvAmt])).wait()
  const f1Before = await bal(f1)
  await (await claim.connect(f1signer).claimGV()).wait()
  check("F1 claimed GV (+50)", (await bal(f1)) - f1Before, gvAmt)

  console.log(`\n═══ FORK-TEST RESULT: ${PASS} passed, ${FAIL} failed ═══`)
  if (FAIL > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
