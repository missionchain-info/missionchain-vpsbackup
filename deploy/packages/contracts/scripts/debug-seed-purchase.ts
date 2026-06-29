/**
 * Debug Script — Investigate SEED Purchase "missing revert data" error
 *
 * Run: npx hardhat run scripts/debug-seed-purchase.ts --network bscTestnet
 */

import { ethers } from "hardhat";

// ─── Deployed Addresses (from deployments/testnet.json) ────────────────────
const ADDRESSES = {
  MockUSDT:      "0xeCa040b5faE7167c1c4Fa4e9A9F2b5413D78a650",
  MICToken:      "0x7864D1B192A27b856f0eB493D7050D067144C7C1",
  LockManager:   "0xB75B8800bBB06d085a72bdA8fA75da4C885C4d1E",
  MFPNFT:        "0x4D1Cc2DDF32fB01105fa5406Dfa7100F60D3f74e",
  SeedSale:      "0x6DDa34fB238a177E1DE7815A7975c023Ba816225",
  SeedBudget:    "0xD7634C001764b1D01D165ac5C46718C08a4111A5",
  LiquidityPool: "0x9B8158D08E5E902a3a6867579BE577213A24b60d",
};

const ADMIN = "0xd32e666381b56f979d60c57831838f05f33ad6c2";

// ─── Minimal ABIs ──────────────────────────────────────────────────────────

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
];

const SEED_SALE_ABI = [
  "function active() view returns (bool)",
  "function whitelisted(address) view returns (bool)",
  "function totalSold() view returns (uint256)",
  "function ALLOCATION() view returns (uint256)",
  "function packages(uint256) view returns (uint256 priceUsdt, uint256 micAmount, uint256 nftCount)",
  "function usdt() view returns (address)",
  "function micToken() view returns (address)",
  "function lockManager() view returns (address)",
  "function mfpNFT() view returns (address)",
  "function seedBudget() view returns (address)",
  "function buyPackage(uint256 packageIndex) external",
];

const SEED_BUDGET_ABI = [
  "function usdt() view returns (address)",
  "function liquidityPool() view returns (address)",
  "function auditWallet() view returns (address)",
  "function daoReserve() view returns (address)",
  "function leadershipWallet(uint256) view returns (address)",
  "function pendingLeadership(uint256) view returns (uint256)",
  "function kpiPoolBalance() view returns (uint256)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function CALLER_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function receiveAndDistribute(uint256) external",
];

const LOCK_MANAGER_ABI = [
  "function lockedOf(address) view returns (uint256)",
  "function availableOf(address) view returns (uint256)",
  "function scheduleCount(address) view returns (uint256)",
  "function getScheduleAt(address,uint256) view returns (tuple(uint256 totalAmount, uint256 startTime, uint256 cliffDuration, uint256 cliffUnlockBps, uint256 monthlyUnlockBps))",
  "function hasRole(bytes32,address) view returns (bool)",
  "function SCHEDULE_CREATOR_ROLE() view returns (bytes32)",
];

const MIC_TOKEN_ABI = [
  ...ERC20_ABI,
  "function lockManager() view returns (address)",
  "function approvedStakingContracts(address) view returns (bool)",
  "function lockedBalanceOf(address) view returns (uint256)",
  "function availableBalanceOf(address) view returns (uint256)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function PAUSER_ROLE() view returns (bytes32)",
  "function paused() view returns (bool)",
];

const MFPNFT_ABI = [
  "function nextTokenId() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function MINTER_ROLE() view returns (bytes32)",
];

const LIQUIDITY_POOL_ABI = [
  "function hasRole(bytes32,address) view returns (bool)",
  "function DISTRIBUTOR_ROLE() view returns (bytes32)",
];

// ─── Helper ────────────────────────────────────────────────────────────────

function fmt6(val: bigint): string {
  return ethers.formatUnits(val, 6);
}
function fmt18(val: bigint): string {
  return ethers.formatUnits(val, 18);
}
function pass(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.log(`  ❌ ${msg}`); }
function info(msg: string) { console.log(`  ℹ️  ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); }

async function isContract(provider: any, addr: string): Promise<boolean> {
  const code = await provider.getCode(addr);
  return code !== "0x";
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const [signer] = await ethers.getSigners();
  const buyer = signer.address;
  const provider = ethers.provider;

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  DEBUG: SEED Purchase — 'missing revert data' Investigation ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
  console.log(`Buyer/Signer: ${buyer}`);
  console.log(`Timestamp:    ${new Date().toISOString()}\n`);

  // Connect contracts
  const usdt = new ethers.Contract(ADDRESSES.MockUSDT, ERC20_ABI, provider);
  const mic = new ethers.Contract(ADDRESSES.MICToken, MIC_TOKEN_ABI, provider);
  const seedSale = new ethers.Contract(ADDRESSES.SeedSale, SEED_SALE_ABI, provider);
  const seedBudget = new ethers.Contract(ADDRESSES.SeedBudget, SEED_BUDGET_ABI, provider);
  const lockManager = new ethers.Contract(ADDRESSES.LockManager, LOCK_MANAGER_ABI, provider);
  const mfpNFT = new ethers.Contract(ADDRESSES.MFPNFT, MFPNFT_ABI, provider);
  const liquidityPool = new ethers.Contract(ADDRESSES.LiquidityPool, LIQUIDITY_POOL_ABI, provider);

  // ════════════════════════════════════════════════════════════════════════
  // 1. Verify all addresses are contracts (not EOA)
  // ════════════════════════════════════════════════════════════════════════
  console.log("═══ 1. CONTRACT EXISTENCE CHECK ═══");
  for (const [name, addr] of Object.entries(ADDRESSES)) {
    const isC = await isContract(provider, addr);
    if (isC) pass(`${name} (${addr}) is a contract`);
    else fail(`${name} (${addr}) is NOT a contract (EOA or empty)`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 2. SeedSale immutable references
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 2. SEEDSALE IMMUTABLE REFERENCES ═══");
  const ssUsdt = await seedSale.usdt();
  const ssMic = await seedSale.micToken();
  const ssLM = await seedSale.lockManager();
  const ssNFT = await seedSale.mfpNFT();
  const ssBudget = await seedSale.seedBudget();

  info(`usdt:        ${ssUsdt} ${ssUsdt.toLowerCase() === ADDRESSES.MockUSDT.toLowerCase() ? '✅' : '❌ MISMATCH'}`);
  info(`micToken:    ${ssMic} ${ssMic.toLowerCase() === ADDRESSES.MICToken.toLowerCase() ? '✅' : '❌ MISMATCH'}`);
  info(`lockManager: ${ssLM} ${ssLM.toLowerCase() === ADDRESSES.LockManager.toLowerCase() ? '✅' : '❌ MISMATCH'}`);
  info(`mfpNFT:      ${ssNFT} ${ssNFT.toLowerCase() === ADDRESSES.MFPNFT.toLowerCase() ? '✅' : '❌ MISMATCH'}`);
  info(`seedBudget:  ${ssBudget} ${ssBudget.toLowerCase() === ADDRESSES.SeedBudget.toLowerCase() ? '✅' : '❌ MISMATCH'}`);

  // ════════════════════════════════════════════════════════════════════════
  // 3. SeedSale state
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 3. SEEDSALE STATE ═══");
  const active = await seedSale.active();
  const wl = await seedSale.whitelisted(buyer);
  const totalSold = await seedSale.totalSold();
  const allocation = await seedSale.ALLOCATION();

  if (active) pass(`active = true`); else fail(`active = false — SALE NOT ACTIVE`);
  if (wl) pass(`whitelisted(${buyer}) = true`); else fail(`whitelisted(${buyer}) = false — NOT WHITELISTED`);
  info(`totalSold:  ${fmt18(totalSold)} MIC`);
  info(`ALLOCATION: ${fmt18(allocation)} MIC`);
  info(`remaining:  ${fmt18(allocation - totalSold)} MIC`);

  // ════════════════════════════════════════════════════════════════════════
  // 4. Package details
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 4. PACKAGE DETAILS ═══");
  for (let i = 0; i < 4; i++) {
    const pkg = await seedSale.packages(i);
    console.log(`  Package ${i}: price=${fmt6(pkg.priceUsdt)} USDT, mic=${fmt18(pkg.micAmount)} MIC, nftCount=${pkg.nftCount}`);
  }

  // Test with package 0 (cheapest: $1,000 / 400K MIC / 20 NFTs)
  const testPkg = 0;
  const pkg = await seedSale.packages(testPkg);
  console.log(`\n  >> Testing with Package ${testPkg}: $${fmt6(pkg.priceUsdt)} USDT / ${fmt18(pkg.micAmount)} MIC / ${pkg.nftCount} NFTs`);

  // Check allocation
  if (totalSold + pkg.micAmount <= allocation) {
    pass(`Allocation check: ${fmt18(totalSold)} + ${fmt18(pkg.micAmount)} <= ${fmt18(allocation)}`);
  } else {
    fail(`Allocation EXHAUSTED: ${fmt18(totalSold)} + ${fmt18(pkg.micAmount)} > ${fmt18(allocation)}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 5. USDT balances and allowances
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 5. USDT BALANCES & ALLOWANCES ═══");
  const buyerUsdtBal = await usdt.balanceOf(buyer);
  const buyerUsdtAllowance = await usdt.allowance(buyer, ADDRESSES.SeedSale);

  info(`Buyer USDT balance:   ${fmt6(buyerUsdtBal)}`);
  info(`Buyer USDT allowance to SeedSale: ${fmt6(buyerUsdtAllowance)}`);

  if (buyerUsdtBal >= pkg.priceUsdt) pass(`Buyer has enough USDT (need ${fmt6(pkg.priceUsdt)})`);
  else fail(`Buyer needs ${fmt6(pkg.priceUsdt)} USDT but only has ${fmt6(buyerUsdtBal)}`);

  if (buyerUsdtAllowance >= pkg.priceUsdt) pass(`Allowance sufficient (need ${fmt6(pkg.priceUsdt)})`);
  else fail(`Allowance too low: ${fmt6(buyerUsdtAllowance)} < ${fmt6(pkg.priceUsdt)} — NEED TO APPROVE MORE`);

  // ════════════════════════════════════════════════════════════════════════
  // 6. SeedBudget configuration
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 6. SEEDBUDGET CONFIGURATION ═══");
  const sbUsdt = await seedBudget.usdt();
  const sbLiqPool = await seedBudget.liquidityPool();
  const sbAudit = await seedBudget.auditWallet();
  const sbDAO = await seedBudget.daoReserve();

  info(`SeedBudget.usdt:          ${sbUsdt}`);
  info(`SeedBudget.liquidityPool: ${sbLiqPool}`);
  info(`SeedBudget.auditWallet:   ${sbAudit}`);
  info(`SeedBudget.daoReserve:    ${sbDAO}`);

  // Check if these are valid addresses (contracts or funded EOAs)
  const lpIsContract = await isContract(provider, sbLiqPool);
  const auditIsContract = await isContract(provider, sbAudit);
  const daoIsContract = await isContract(provider, sbDAO);

  info(`liquidityPool is contract: ${lpIsContract}`);
  info(`auditWallet is contract: ${auditIsContract}`);
  info(`daoReserve is contract: ${daoIsContract}`);

  // Check SeedBudget CALLER_ROLE for SeedSale
  const callerRole = await seedBudget.CALLER_ROLE();
  const seedSaleHasCallerRole = await seedBudget.hasRole(callerRole, ADDRESSES.SeedSale);
  if (seedSaleHasCallerRole) pass(`SeedSale has CALLER_ROLE on SeedBudget`);
  else fail(`SeedSale does NOT have CALLER_ROLE on SeedBudget`);

  // Check if LiquidityPool has DISTRIBUTOR_ROLE for SeedBudget (SeedBudget sends USDT to LiquidityPool via safeTransfer)
  // Actually SeedBudget does NOT use DISTRIBUTOR_ROLE — it just does safeTransfer directly.
  // But LiquidityPool might reject USDT if it doesn't accept arbitrary transfers.
  // Let's check if LiquidityPool contract can receive ERC20 tokens.
  const lpUsdtBal = await usdt.balanceOf(sbLiqPool);
  info(`LiquidityPool USDT balance: ${fmt6(lpUsdtBal)}`);

  // Leadership wallets
  console.log("\n  Leadership wallets:");
  for (let i = 0; i < 7; i++) {
    const w = await seedBudget.leadershipWallet(i);
    console.log(`    [${i}]: ${w}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 7. MIC Token state
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 7. MIC TOKEN STATE ═══");
  const micPaused = await mic.paused();
  if (!micPaused) pass(`MIC token is NOT paused`);
  else fail(`MIC token IS PAUSED — ALL TRANSFERS BLOCKED`);

  const micLockMgr = await mic.lockManager();
  info(`MIC.lockManager: ${micLockMgr}`);
  if (micLockMgr.toLowerCase() === ADDRESSES.LockManager.toLowerCase()) {
    pass(`MIC lockManager matches deployed LockManager`);
  } else if (micLockMgr === ethers.ZeroAddress) {
    warn(`MIC lockManager is ZERO — lock checks disabled`);
  } else {
    fail(`MIC lockManager MISMATCH: ${micLockMgr}`);
  }

  const seedSaleMicBal = await mic.balanceOf(ADDRESSES.SeedSale);
  info(`SeedSale MIC balance: ${fmt18(seedSaleMicBal)}`);
  if (seedSaleMicBal >= pkg.micAmount) pass(`SeedSale has enough MIC for package (need ${fmt18(pkg.micAmount)})`);
  else fail(`SeedSale MIC insufficient: ${fmt18(seedSaleMicBal)} < ${fmt18(pkg.micAmount)}`);

  // Critical: Check if SeedSale's MIC is locked via LockManager
  const seedSaleLockedMic = await lockManager.lockedOf(ADDRESSES.SeedSale);
  info(`SeedSale locked MIC (via LockManager): ${fmt18(seedSaleLockedMic)}`);

  if (seedSaleLockedMic > 0n) {
    const available = seedSaleMicBal - seedSaleLockedMic;
    warn(`SeedSale has ${fmt18(seedSaleLockedMic)} LOCKED MIC!`);
    info(`SeedSale available (unlocked) MIC: ${fmt18(available > 0n ? available : 0n)}`);
    if (available < pkg.micAmount) {
      fail(`*** LIKELY ROOT CAUSE: SeedSale cannot transfer ${fmt18(pkg.micAmount)} MIC because ${fmt18(seedSaleLockedMic)} is locked! ***`);
    }
  } else {
    pass(`SeedSale has 0 locked MIC`);
  }

  // Check buyer's MIC state (in case transfer TO buyer is blocked)
  const buyerMicBal = await mic.balanceOf(buyer);
  const buyerLockedMic = await lockManager.lockedOf(buyer);
  const buyerScheduleCount = await lockManager.scheduleCount(buyer);
  info(`Buyer MIC balance: ${fmt18(buyerMicBal)}`);
  info(`Buyer locked MIC:  ${fmt18(buyerLockedMic)}`);
  info(`Buyer schedule count: ${buyerScheduleCount}`);

  // ════════════════════════════════════════════════════════════════════════
  // 8. MFPNFT state
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 8. MFPNFT STATE ═══");
  const nextTokenId = await mfpNFT.nextTokenId();
  const maxSupply = await mfpNFT.maxSupply();
  info(`nextTokenId: ${nextTokenId}`);
  info(`maxSupply:   ${maxSupply}`);
  info(`remaining:   ${maxSupply - nextTokenId}`);

  if (nextTokenId + BigInt(pkg.nftCount) <= maxSupply) {
    pass(`Enough MFP supply for ${pkg.nftCount} NFTs`);
  } else {
    fail(`MFP supply exhausted: ${nextTokenId} + ${pkg.nftCount} > ${maxSupply}`);
  }

  const minterRole = await mfpNFT.MINTER_ROLE();
  const seedSaleHasMinterRole = await mfpNFT.hasRole(minterRole, ADDRESSES.SeedSale);
  if (seedSaleHasMinterRole) pass(`SeedSale has MINTER_ROLE on MFPNFT`);
  else fail(`SeedSale does NOT have MINTER_ROLE on MFPNFT`);

  // ════════════════════════════════════════════════════════════════════════
  // 9. LockManager roles
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 9. LOCKMANAGER ROLES ═══");
  const schedCreatorRole = await lockManager.SCHEDULE_CREATOR_ROLE();
  const seedSaleHasScheduleCreator = await lockManager.hasRole(schedCreatorRole, ADDRESSES.SeedSale);
  if (seedSaleHasScheduleCreator) pass(`SeedSale has SCHEDULE_CREATOR_ROLE on LockManager`);
  else fail(`SeedSale does NOT have SCHEDULE_CREATOR_ROLE on LockManager`);

  // ════════════════════════════════════════════════════════════════════════
  // 10. Simulate each step of buyPackage individually
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 10. STEP-BY-STEP SIMULATION ═══");

  // Step 1: USDT.transferFrom(buyer → SeedSale)
  console.log("\n  Step 1: USDT.transferFrom(buyer → SeedSale)");
  try {
    const usdtWithSigner = usdt.connect(signer) as any;
    // We can't easily simulate transferFrom as SeedSale, but we can check the allowance
    info(`This step uses safeTransferFrom — requires allowance >= ${fmt6(pkg.priceUsdt)}`);
    if (buyerUsdtAllowance >= pkg.priceUsdt) pass(`Allowance OK`);
    else fail(`Allowance insufficient`);
  } catch (e: any) {
    fail(`Error: ${e.message}`);
  }

  // Step 2: SeedBudget.receiveAndDistribute — the complex one
  // SeedSale approves SeedBudget for USDT, then calls receiveAndDistribute
  // SeedBudget pulls USDT from SeedSale, then sends to liquidityPool, auditWallet, daoReserve
  console.log("\n  Step 2: SeedBudget.receiveAndDistribute flow");
  console.log("    SeedSale → forceApprove(SeedBudget, amount)");
  console.log("    SeedBudget → safeTransferFrom(SeedSale, self, amount)");
  console.log("    SeedBudget → safeTransfer(liquidityPool, 40%)");
  console.log("    SeedBudget → safeTransfer(auditWallet, 5%)");
  console.log("    SeedBudget → safeTransfer(daoReserve, 5%)");

  // Check: Is LiquidityPool a contract that might reject USDT transfers?
  // SeedBudget uses safeTransfer which is just a regular ERC20 transfer — any address can receive.
  // But if liquidityPool, auditWallet, or daoReserve is address(0) or has some issue...
  if (sbLiqPool === ethers.ZeroAddress) fail(`liquidityPool is ZERO ADDRESS`);
  if (sbAudit === ethers.ZeroAddress) fail(`auditWallet is ZERO ADDRESS`);
  if (sbDAO === ethers.ZeroAddress) fail(`daoReserve is ZERO ADDRESS`);

  // Step 3: MIC.safeTransfer(buyer, micAmount)
  console.log("\n  Step 3: MIC.safeTransfer(SeedSale → buyer)");
  // This is where the lock check happens in MICToken._update()
  // from = SeedSale, to = buyer
  // Check: balanceOf(SeedSale) - value >= lockedOf(SeedSale)
  const effectiveAvailable = seedSaleMicBal - seedSaleLockedMic;
  info(`SeedSale balance: ${fmt18(seedSaleMicBal)}, locked: ${fmt18(seedSaleLockedMic)}, available: ${fmt18(effectiveAvailable)}`);
  if (effectiveAvailable >= pkg.micAmount) {
    pass(`MIC transfer should succeed`);
  } else {
    fail(`*** MIC TRANSFER WILL FAIL: available ${fmt18(effectiveAvailable)} < needed ${fmt18(pkg.micAmount)} ***`);
  }

  // Step 4: LockManager.createSchedule
  console.log("\n  Step 4: LockManager.createSchedule");
  info(`Will create: beneficiary=${buyer}, amount=${fmt18(pkg.micAmount)}, cliff=180d, cliffBps=1000, monthlyBps=250`);

  // Step 5: MFPNFT.mintBatch
  console.log("\n  Step 5: MFPNFT.mintBatch(${buyer}, ${pkg.nftCount})");
  info(`Will mint ${pkg.nftCount} MFP-NFTs to ${buyer}`);

  // ════════════════════════════════════════════════════════════════════════
  // 11. Function selector verification
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 11. FUNCTION SELECTOR VERIFICATION ═══");
  const iface = new ethers.Interface(SEED_SALE_ABI);
  const buyPackageSig = iface.getFunction("buyPackage")!;
  const selector = iface.getFunction("buyPackage")!.selector;
  info(`buyPackage(uint256) selector: ${selector}`);
  if (selector === "0xab69523b") {
    pass(`Selector matches 0xab69523b`);
  } else {
    fail(`Selector MISMATCH: expected 0xab69523b, got ${selector}`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 12. Try staticCall to get actual revert reason
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 12. STATIC CALL SIMULATION ═══");
  const seedSaleWithSigner = seedSale.connect(signer) as any;

  try {
    console.log("  Attempting buyPackage.staticCall(0) ...");
    await seedSaleWithSigner.buyPackage.staticCall(testPkg);
    pass("staticCall succeeded — transaction SHOULD work!");
  } catch (e: any) {
    fail(`staticCall FAILED`);
    console.log(`\n  Error details:`);
    console.log(`    message: ${e.message}`);
    if (e.data) console.log(`    data:    ${e.data}`);
    if (e.reason) console.log(`    reason:  ${e.reason}`);
    if (e.code) console.log(`    code:    ${e.code}`);
    if (e.revert) console.log(`    revert:  ${JSON.stringify(e.revert)}`);

    // Try to decode the error data
    if (e.data && e.data !== "0x") {
      try {
        // Common error selectors
        const errorSelectors: Record<string, string> = {
          "0x08c379a0": "Error(string)",
          "0x4e487b71": "Panic(uint256)",
          "0xe450d38c": "ERC20InsufficientBalance",
          "0xfb8f41b2": "ERC20InsufficientAllowance",
        };
        const sel = e.data.slice(0, 10);
        info(`Error selector: ${sel} → ${errorSelectors[sel] || 'unknown'}`);
      } catch {}
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // 13. Estimate gas directly
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 13. GAS ESTIMATION ═══");
  try {
    const calldata = iface.encodeFunctionData("buyPackage", [testPkg]);
    const gasEstimate = await provider.estimateGas({
      from: buyer,
      to: ADDRESSES.SeedSale,
      data: calldata,
    });
    pass(`Gas estimate: ${gasEstimate.toString()}`);
  } catch (e: any) {
    fail(`Gas estimation FAILED`);
    console.log(`    message: ${e.message?.substring(0, 200)}`);
    if (e.data) console.log(`    data: ${e.data}`);
    if (e.error?.data) console.log(`    error.data: ${e.error.data}`);

    // Try to decode inner error
    if (e.info?.error?.data) {
      console.log(`    info.error.data: ${e.info.error.data}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // 14. Deep investigation: Try calling SeedBudget.receiveAndDistribute directly
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 14. SEEDBUDGET RECEIVE CHECK ═══");
  // SeedBudget.receiveAndDistribute requires CALLER_ROLE — we can't call it directly
  // But we can check if the sub-transfers would work

  const testAmount = pkg.priceUsdt; // e.g., 1000e6
  const liqAmt = (testAmount * 4000n) / 10000n;
  const audAmt = (testAmount * 500n) / 10000n;
  const daoAmt = (testAmount * 500n) / 10000n;

  info(`For ${fmt6(testAmount)} USDT:`);
  info(`  → liquidityPool: ${fmt6(liqAmt)} USDT`);
  info(`  → auditWallet:   ${fmt6(audAmt)} USDT`);
  info(`  → daoReserve:    ${fmt6(daoAmt)} USDT`);
  info(`  → leadership:    ${fmt6(testAmount - liqAmt - audAmt - daoAmt)} USDT (accumulated in contract)`);

  // ════════════════════════════════════════════════════════════════════════
  // 15. Check if the buyer (deployer) has existing vesting that could interfere
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 15. BUYER VESTING SCHEDULES ═══");
  const buyerSchedCount = await lockManager.scheduleCount(buyer);
  info(`Buyer has ${buyerSchedCount} vesting schedule(s)`);

  for (let i = 0; i < Number(buyerSchedCount); i++) {
    const sched = await lockManager.getScheduleAt(buyer, i);
    console.log(`  Schedule ${i}:`);
    console.log(`    totalAmount:     ${fmt18(sched.totalAmount)} MIC`);
    console.log(`    startTime:       ${new Date(Number(sched.startTime) * 1000).toISOString()}`);
    console.log(`    cliffDuration:   ${Number(sched.cliffDuration) / 86400} days`);
    console.log(`    cliffUnlockBps:  ${sched.cliffUnlockBps} (${Number(sched.cliffUnlockBps) / 100}%)`);
    console.log(`    monthlyUnlockBps: ${sched.monthlyUnlockBps} (${Number(sched.monthlyUnlockBps) / 100}%)`);
  }

  // Important: The deployer wallet has 280M + 105M = 385M MIC locked in vesting
  // When SeedSale transfers MIC to deployer, the deployer's MIC increases
  // but the lock check is on the SENDER (SeedSale), not the receiver
  // So this shouldn't be an issue — unless MICToken._update checks the receiver too
  info(`Note: MIC._update() lock check is on 'from' address only, not 'to'`);

  // ════════════════════════════════════════════════════════════════════════
  // 16. Check SeedSale's vesting schedules (should be 0)
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 16. SEEDSALE VESTING SCHEDULES ═══");
  const ssSchedCount = await lockManager.scheduleCount(ADDRESSES.SeedSale);
  info(`SeedSale has ${ssSchedCount} vesting schedule(s)`);

  for (let i = 0; i < Number(ssSchedCount); i++) {
    const sched = await lockManager.getScheduleAt(ADDRESSES.SeedSale, i);
    console.log(`  Schedule ${i}: totalAmount=${fmt18(sched.totalAmount)} MIC`);
    fail(`SeedSale should NOT have vesting schedules! This would lock its MIC.`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // 17. Check USDT balance of SeedBudget (in case it already has funds)
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 17. SEEDBUDGET USDT BALANCE ═══");
  const sbUsdtBal = await usdt.balanceOf(ADDRESSES.SeedBudget);
  info(`SeedBudget USDT balance: ${fmt6(sbUsdtBal)}`);

  // ════════════════════════════════════════════════════════════════════════
  // 18. Try to call eth_call with full trace data
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n═══ 18. RAW ETH_CALL ═══");
  try {
    const calldata = iface.encodeFunctionData("buyPackage", [testPkg]);
    const result = await provider.call({
      from: buyer,
      to: ADDRESSES.SeedSale,
      data: calldata,
    });
    pass(`eth_call succeeded, result: ${result}`);
  } catch (e: any) {
    fail(`eth_call FAILED`);
    console.log(`    message: ${e.message?.substring(0, 300)}`);
    if (e.data) console.log(`    data: ${e.data}`);

    // Try to decode revert reason from the error data
    if (e.data && e.data.length > 10) {
      try {
        const errorData = e.data;
        const selector = errorData.slice(0, 10);

        if (selector === "0x08c379a0") {
          // Error(string)
          const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + errorData.slice(10));
          fail(`REVERT REASON: "${decoded[0]}"`);
        } else if (selector === "0x4e487b71") {
          // Panic(uint256)
          const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], "0x" + errorData.slice(10));
          fail(`PANIC CODE: ${decoded[0]} (1=assert, 17=overflow, 18=div0, 33=enum, 50=array, 81=uninit)`);
        }
      } catch (decodeErr) {
        info(`Could not decode error data`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                         SUMMARY                             ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Collect potential issues
  const issues: string[] = [];
  if (!active) issues.push("Sale not active");
  if (!wl) issues.push("Buyer not whitelisted");
  if (buyerUsdtAllowance < pkg.priceUsdt) issues.push("Insufficient USDT allowance");
  if (buyerUsdtBal < pkg.priceUsdt) issues.push("Insufficient USDT balance");
  if (seedSaleMicBal < pkg.micAmount) issues.push("SeedSale has insufficient MIC");
  if (seedSaleLockedMic > 0n && (seedSaleMicBal - seedSaleLockedMic) < pkg.micAmount) {
    issues.push("SeedSale MIC is LOCKED — cannot transfer");
  }
  if (micPaused) issues.push("MIC token is PAUSED");
  if (Number(ssSchedCount) > 0) issues.push("SeedSale has vesting schedules (locking its MIC)");
  if (!seedSaleHasCallerRole) issues.push("SeedSale missing CALLER_ROLE on SeedBudget");
  if (!seedSaleHasMinterRole) issues.push("SeedSale missing MINTER_ROLE on MFPNFT");
  if (!seedSaleHasScheduleCreator) issues.push("SeedSale missing SCHEDULE_CREATOR_ROLE on LockManager");

  if (issues.length === 0) {
    console.log("  All pre-checks passed. The error may be:");
    console.log("  - A gas estimation issue on BSC testnet");
    console.log("  - A subtle revert in one of the sub-calls");
    console.log("  - Check the staticCall and eth_call results above for details");
  } else {
    console.log("  ISSUES FOUND:");
    for (const issue of issues) {
      console.log(`  ❌ ${issue}`);
    }
  }

  console.log("\n  Done.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
