import { ethers } from "hardhat"
import fs from "fs"
import path from "path"

// Mainnet addresses (existing contracts)
const USDT_MAINNET    = "0x55d398326f99059fF775485246999027B3197955"
const MIC_MAINNET     = "0xf27ec0c311728b923b22828002c992c799326182"
const LOCK_MAINNET    = "0x6bE58BCe62f526E7751e121CDBa1eb22873471A0"
const MFP_MAINNET     = "0xAE6F32A6fdf80F5e54ba85441386dBA6a381f565"
const COUNCIL_MAINNET = "0x87723621D50fcc6f6db25d73031E44Bee4081B19"
const FEE_RECEIVER    = "0x6514D6e02370F5987dD61dFb4A9569B7744E2DfC"

async function main() {
  const [deployer] = await ethers.getSigners()
  const net = await ethers.provider.getNetwork()
  console.log("=== SEED Budget V5c Trio Deploy ===")
  console.log("Deployer:", deployer.address)
  console.log("Network:", net.chainId.toString(), `(${net.name || "unknown"})`)

  const balBefore = await ethers.provider.getBalance(deployer.address)
  console.log("Balance before:", ethers.formatEther(balBefore), "BNB\n")

  // ─── Decide addresses to use based on network ─────────────────────
  // On hardhat localhost: deploy mocks for dependencies
  // On bscMainnet (56): use existing mainnet addresses
  const isMainnet = net.chainId === 56n
  let usdtAddr: string, micAddr: string, lockAddr: string, mfpAddr: string, councilAddr: string

  if (isMainnet) {
    usdtAddr    = USDT_MAINNET
    micAddr     = MIC_MAINNET
    lockAddr    = LOCK_MAINNET
    mfpAddr     = MFP_MAINNET
    councilAddr = COUNCIL_MAINNET
    console.log("Using existing mainnet contracts as dependencies\n")
  } else {
    console.log("Local network — deploying mock dependencies first")
    const MockUSDT = await ethers.getContractFactory("MockUSDT")
    const usdt = await MockUSDT.deploy()
    await usdt.waitForDeployment()
    usdtAddr = await usdt.getAddress()
    console.log("MockUSDT:", usdtAddr)

    const MIC = await ethers.getContractFactory("MICToken")
    const mic = await MIC.deploy(deployer.address)
    await mic.waitForDeployment()
    micAddr = await mic.getAddress()
    console.log("MICToken:", micAddr)

    const MockLock = await ethers.getContractFactory("MockLockManagerV6")
    const lock = await MockLock.deploy()
    await lock.waitForDeployment()
    lockAddr = await lock.getAddress()
    console.log("MockLockManagerV6:", lockAddr)

    const MockMFP = await ethers.getContractFactory("MockMFPNFTV6")
    const mfp = await MockMFP.deploy()
    await mfp.waitForDeployment()
    mfpAddr = await mfp.getAddress()
    console.log("MockMFPNFTV6:", mfpAddr)

    const SC = await ethers.getContractFactory("StewardCouncil")
    const council = await SC.deploy(deployer.address)
    await council.waitForDeployment()
    councilAddr = await council.getAddress()
    console.log("StewardCouncil:", councilAddr)
    console.log()
  }

  // ─── Deploy V5c ───────────────────────────────────────────────────
  console.log("1. SeedBudgetV5c...")
  const V5c = await ethers.getContractFactory("SeedBudgetV5c")
  const v5c = await V5c.deploy(usdtAddr, deployer.address)
  await v5c.waitForDeployment()
  const v5cAddr = await v5c.getAddress()
  console.log("   →", v5cAddr)

  // ─── Deploy OSP V3 ────────────────────────────────────────────────
  console.log("2. OperationalSalaryPoolV3...")
  const OSP = await ethers.getContractFactory("OperationalSalaryPoolV3")
  const osp = await OSP.deploy(councilAddr, v5cAddr, deployer.address)
  await osp.waitForDeployment()
  const ospAddr = await osp.getAddress()
  console.log("   →", ospAddr)

  // ─── Deploy MBP V3 ────────────────────────────────────────────────
  console.log("3. ManagementBonusPoolV3...")
  const MBP = await ethers.getContractFactory("ManagementBonusPoolV3")
  const mbp = await MBP.deploy(councilAddr, v5cAddr, deployer.address)
  await mbp.waitForDeployment()
  const mbpAddr = await mbp.getAddress()
  console.log("   →", mbpAddr)

  // ─── Deploy REP V3 ────────────────────────────────────────────────
  console.log("4. ReservedExpensesPoolV3...")
  const REP = await ethers.getContractFactory("ReservedExpensesPoolV3")
  const rep = await REP.deploy(councilAddr, v5cAddr, deployer.address)
  await rep.waitForDeployment()
  const repAddr = await rep.getAddress()
  console.log("   →", repAddr)

  // ─── Inherit V6 oldInvestorsGranted (mainnet only) ────────────────
  const V6_MAINNET = "0x7ce5AcDC5DACf59aaB130C963ac461f902A5e5A0"
  let initialOldInvestorsGranted = 0n
  if (isMainnet) {
    const v6 = await ethers.getContractAt([
      "function oldInvestorsGranted() view returns (uint256)",
    ], V6_MAINNET)
    initialOldInvestorsGranted = await v6.oldInvestorsGranted()
    console.log(`Inheriting V6 oldInvestorsGranted: ${ethers.formatUnits(initialOldInvestorsGranted, 18)} MIC`)
  }

  // ─── Deploy SeedSaleV7 ────────────────────────────────────────────
  console.log("5. SeedSaleV7...")
  const V7 = await ethers.getContractFactory("SeedSaleV7")
  const v7 = await V7.deploy(
    usdtAddr,
    micAddr,
    lockAddr,
    mfpAddr,
    v5cAddr,
    deployer.address,
    initialOldInvestorsGranted, // _initialOldInvestorsGranted (inherited from V6 on mainnet)
  )
  await v7.waitForDeployment()
  const v7Addr = await v7.getAddress()
  console.log("   →", v7Addr)
  console.log()

  // ─── Wire V5c roles ───────────────────────────────────────────────
  console.log("=== Wiring roles ===")
  const CALLER = await v5c.CALLER_ROLE()
  await (await v5c.grantRole(CALLER, v7Addr)).wait()
  console.log("V5c.grantRole(CALLER_ROLE, V7) ✓")

  await (await v5c.setSlotController(0, deployer.address)).wait()
  console.log("V5c.setSlotController(0, deployer) ✓")
  await (await v5c.setSlotController(1, ospAddr)).wait()
  console.log("V5c.setSlotController(1, OSP V3) ✓")
  await (await v5c.setSlotController(2, mbpAddr)).wait()
  console.log("V5c.setSlotController(2, MBP V3) ✓")
  await (await v5c.setSlotController(3, repAddr)).wait()
  console.log("V5c.setSlotController(3, REP V3) ✓")

  await (await v5c.setFee(500, FEE_RECEIVER)).wait()
  console.log(`V5c.setFee(500, ${FEE_RECEIVER}) ✓`)
  console.log()

  // ─── External role wires (only meaningful on mainnet) ────────────
  if (isMainnet) {
    console.log("=== External role wires (mainnet only) ===")
    // LockManager: SCHEDULE_CREATOR_ROLE → V7
    const lockManager = await ethers.getContractAt([
      "function SCHEDULE_CREATOR_ROLE() view returns (bytes32)",
      "function grantRole(bytes32,address) external",
    ], lockAddr)
    const SCHED = await lockManager.SCHEDULE_CREATOR_ROLE()
    await (await lockManager.grantRole(SCHED, v7Addr)).wait()
    console.log("LockManager.grantRole(SCHEDULE_CREATOR_ROLE, V7) ✓")

    // MFPNFT: SEED_GRANTER_ROLE → V7
    const mfpContract = await ethers.getContractAt([
      "function SEED_GRANTER_ROLE() view returns (bytes32)",
      "function grantRole(bytes32,address) external",
    ], mfpAddr)
    const SEED_GRANTER = await mfpContract.SEED_GRANTER_ROLE()
    await (await mfpContract.grantRole(SEED_GRANTER, v7Addr)).wait()
    console.log("MFPNFT.grantRole(SEED_GRANTER_ROLE, V7) ✓")

    // LockManager: ADMIN_GRANTER_ROLE → V7 (for adminGrantOldInvestor → createScheduleWithStart backdated)
    // CRITICAL: without this, Old Investor grants revert AccessControlUnauthorizedAccount. (Fixed 2026-06-23)
    const lockManagerAdmin = await ethers.getContractAt([
      "function grantRole(bytes32,address) external",
    ], lockAddr)
    const ADMIN_GRANTER_ROLE = "0x15baebe8ae0bf815fd0537f8d232f23c09346a1082ea8351a5fc4a5891e65ebc"
    await (await lockManagerAdmin.grantRole(ADMIN_GRANTER_ROLE, v7Addr)).wait()
    console.log("LockManager.grantRole(ADMIN_GRANTER_ROLE, V7) ✓")
    console.log()
  } else {
    console.log("(Skipping external LockManager/MFPNFT role grants on local network — mocks don't enforce.)\n")
  }

  // ─── Save manifest ────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const manifest = {
    network: isMainnet ? "bsc-mainnet" : "local",
    chainId: Number(net.chainId),
    deployedAt: today,
    deployer: deployer.address,
    contracts: {
      SeedBudgetV5c:           v5cAddr,
      OperationalSalaryPoolV3: ospAddr,
      ManagementBonusPoolV3:   mbpAddr,
      ReservedExpensesPoolV3:  repAddr,
      SeedSaleV7:              v7Addr,
    },
    dependencies: {
      USDT:           usdtAddr,
      MICToken:       micAddr,
      LockManager:    lockAddr,
      MFPNFT:         mfpAddr,
      StewardCouncil: councilAddr,
    },
    constructorArgs: {
      SeedBudgetV5c:           [usdtAddr, deployer.address],
      OperationalSalaryPoolV3: [councilAddr, v5cAddr, deployer.address],
      ManagementBonusPoolV3:   [councilAddr, v5cAddr, deployer.address],
      ReservedExpensesPoolV3:  [councilAddr, v5cAddr, deployer.address],
      SeedSaleV7:              [usdtAddr, micAddr, lockAddr, mfpAddr, v5cAddr, deployer.address, initialOldInvestorsGranted.toString()],
    },
    wiring: {
      "V5c CALLER_ROLE → V7":                "granted",
      "V5c slot[0] controller → deployer":   "set",
      "V5c slot[1] controller → OSP V3":     "set",
      "V5c slot[2] controller → MBP V3":     "set",
      "V5c slot[3] controller → REP V3":     "set",
      "V5c feeBps":                          "500",
      "V5c feeReceiver":                     FEE_RECEIVER,
      "LockManager SCHEDULE_CREATOR → V7":   isMainnet ? "granted" : "skipped (local)",
      "MFPNFT SEED_GRANTER → V7":            isMainnet ? "granted" : "skipped (local)",
    },
  }

  const filename = `seed-budget-v5c-${today}-${isMainnet ? "mainnet" : "local"}.json`
  const manifestDir = path.resolve(__dirname, "..", "..", "sdk", "src", "deployments")
  fs.mkdirSync(manifestDir, { recursive: true })
  const manifestPath = path.join(manifestDir, filename)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log("Manifest:", manifestPath)

  // ─── Summary ──────────────────────────────────────────────────────
  const balAfter = await ethers.provider.getBalance(deployer.address)
  console.log("\nBalance after:", ethers.formatEther(balAfter), "BNB")
  console.log("Cost:", ethers.formatEther(balBefore - balAfter), "BNB")
  console.log("\n=== DEPLOY COMPLETE ===")

  if (isMainnet) {
    console.log("\nNext steps:")
    console.log("1. BSCScan verify all 5 contracts (Task 12)")
    console.log("2. Council enrollment in OSP V3 (Task 13)")
    console.log("3. SeedSaleV6.setActive(false) — sunset V6 (Task 14)")
    console.log("4. Mainnet smoke test $1K purchase (Task 15)")
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
