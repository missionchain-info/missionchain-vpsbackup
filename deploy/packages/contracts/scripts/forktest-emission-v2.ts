/**
 * Mainnet-fork rehearsal for EmissionControllerV2.
 *
 * Runs the entire cutover against the real MICToken, the real MiningPool and the two
 * licences that actually exist on chain, then checks that a real licence owner can claim
 * the published rate. Nothing here touches mainnet.
 *
 *   FORK_BSC=1 npx hardhat run scripts/forktest-emission-v2.ts --network hardhat
 */
import { ethers, network } from "hardhat";

const OWNER = "0xD32e666381b56f979D60C57831838f05F33AD6c2";
const MIC   = "0xf27ec0c311728b923b22828002c992c799326182";
const EC_V1 = "0x37f38f383b4065BA58C7A6Fc1a91d2dF4f9f86F0";
const MP    = "0x9178292E960cb17380dd329866e725e33200e04f";
const MICE  = "0x4d5147aC4aa44eFc1Ae6196FcE4c87567aA4BD8c";

const DAY = 86_400;
const RATE = 83_333333333333333333n;
const f = (x: bigint, d = 4) => Number(ethers.formatEther(x)).toLocaleString("vi-VN", { maximumFractionDigits: d });

async function main() {
  if (process.env.FORK_BSC !== "1") throw new Error("Set FORK_BSC=1");

  // A pinned fork makes the fork block itself "historical", and BSC has hardforks newer
  // than anything the local chain knows. Mine one local block so every later call lands
  // on our own chain instead of asking EDR to price a historical BSC block.
  await network.provider.send("evm_mine");

  const bn = await ethers.provider.getBlockNumber();
  console.log(`\n═══ Diễn tập EmissionControllerV2 trên fork BSC @ block ${bn} ═══\n`);

  await network.provider.send("hardhat_impersonateAccount", [OWNER]);
  await network.provider.send("hardhat_setBalance", [OWNER, "0x56BC75E2D63100000"]);
  const owner = await ethers.getSigner(OWNER);

  const mic = await ethers.getContractAt(
    ["function MINTER_ROLE() view returns(bytes32)",
     "function grantRole(bytes32,address)", "function revokeRole(bytes32,address)",
     "function hasRole(bytes32,address) view returns(bool)",
     "function remainingMiningPool() view returns(uint256)",
     "function totalMiningMinted() view returns(uint256)",
     "function balanceOf(address) view returns(uint256)"], MIC);

  const mp = await ethers.getContractAt(
    ["function EMISSION_ROLE() view returns(bytes32)",
     "function grantRole(bytes32,address)", "function revokeRole(bytes32,address)",
     "function hasRole(bytes32,address) view returns(bool)",
     "function totalActive() view returns(uint256)",
     "function pendingExpiries() view returns(uint256)",
     "function pendingOf(uint256) view returns(uint256)",
     "function licenceOwner(uint256) view returns(address)",
     "function claim(uint256[])"], MP);

  const v1 = await ethers.getContractAt(
    ["function stakingPool() view returns(address)", "function daoTreasury() view returns(address)",
     "function communityNFTPool() view returns(address)", "function mfpRewardPool() view returns(address)",
     "function dailyEmission() view returns(uint256)", "function totalEmitted() view returns(uint256)"], EC_V1);

  // ── 0. State as it stands ──
  const [staking, dao, community, mfpPool] = await Promise.all([
    v1.stakingPool(), v1.daoTreasury(), v1.communityNFTPool(), v1.mfpRewardPool(),
  ]);
  const active = await mp.totalActive();
  console.log("── Hiện trạng ──");
  console.log(`  MiningPool.totalActive   ${active}`);
  console.log(`  V1.dailyEmission         ${f(await v1.dailyEmission())} MIC/ngày  ← đang trả`);
  console.log(`  V1.totalEmitted          ${f(await v1.totalEmitted())} MIC`);
  console.log(`  remainingMiningPool      ${f(await mic.remainingMiningPool(), 0)} MIC`);
  if (active > 0n) console.log(`  V1 trả mỗi licence       ${f((await v1.dailyEmission()) * 5900n / 10000n / active)} MIC/ngày`);

  // ── 1. Deploy V2 ──
  const v2 = await (await ethers.getContractFactory("EmissionControllerV2", owner)).deploy(
    MIC, MP, staking, dao, community, mfpPool, OWNER,
  );
  await v2.waitForDeployment();
  const v2Addr = await v2.getAddress();
  console.log(`\n── Deploy ──\n  EmissionControllerV2  ${v2Addr}`);
  console.log(`  đọc N từ MiningPool   ${await v2.activeLicences()}  (V1 đọc MICELicense.activeLicenses)`);

  // ── 2. Cutover: move both roles from V1 to V2 ──
  const MINTER = await mic.MINTER_ROLE();
  const EMIT   = await mp.EMISSION_ROLE();
  await (await mic.connect(owner).grantRole(MINTER, v2Addr)).wait();
  await (await mp.connect(owner).grantRole(EMIT, v2Addr)).wait();
  await (await mic.connect(owner).revokeRole(MINTER, EC_V1)).wait();
  await (await mp.connect(owner).revokeRole(EMIT, EC_V1)).wait();
  console.log("\n── Chuyển vai ──");
  console.log(`  MICToken.MINTER_ROLE   V2 ${await mic.hasRole(MINTER, v2Addr)}   V1 ${await mic.hasRole(MINTER, EC_V1)}`);
  console.log(`  MiningPool.EMISSION    V2 ${await mp.hasRole(EMIT, v2Addr)}   V1 ${await mp.hasRole(EMIT, EC_V1)}`);

  // V1 must now be inert — prove it rather than assume it.
  try {
    await (await ethers.getContractAt(["function distributeDaily()"], EC_V1)).distributeDaily();
    throw new Error("❌ V1 vẫn phát hành được sau khi thu vai");
  } catch (e: any) {
    if (String(e.message).includes("vẫn phát hành")) throw e;
    console.log("  V1.distributeDaily()   revert ✅ (đã vô hiệu)");
  }

  // ── 3. One day of real issuance ──
  const before = await mic.totalMiningMinted();
  await network.provider.send("evm_increaseTime", [DAY]);
  await network.provider.send("evm_mine");

  const n = await v2.activeLicences();
  const rc = await (await v2.distributeDaily()).wait();
  const ev = rc!.logs.map((l: any) => { try { return v2.interface.parseLog(l); } catch { return null; } })
                     .find((x: any) => x?.name === "DailyDistributed");
  const [, nEv, elapsed, minted, toMiners, toStaking, toDao, toComm, toMfp] = ev!.args;

  console.log("\n── Một ngày phát hành ──");
  console.log(`  N                      ${nEv}`);
  console.log(`  elapsed                ${elapsed} giây`);
  console.log(`  phát hành              ${f(minted)} MIC`);
  console.log(`    → miners             ${f(toMiners)}`);
  console.log(`    → staking            ${f(toStaking)}`);
  console.log(`    → DAO                ${f(toDao)}`);
  console.log(`    → Community NFT      ${f(toComm)}`);
  console.log(`    → MFP Reward         ${f(toMfp)}`);
  console.log(`  tổng 5 nhánh = mint    ${toMiners + toStaking + toDao + toComm + toMfp === minted ? "✅" : "❌"}`);
  console.log(`  quỹ đào giảm đúng      ${(await mic.totalMiningMinted()) - before === minted ? "✅" : "❌"}`);

  const perLicence = toMiners / (n === 0n ? 1n : n);
  const expected = RATE * elapsed / BigInt(DAY);
  const off = perLicence > expected ? perLicence - expected : expected - perLicence;
  console.log(`\n  mỗi licence            ${f(perLicence)} MIC`);
  console.log(`  công bố                ${f(expected)} MIC`);
  console.log(`  lệch                   ${off} wei  ${off < 1000n ? "✅" : "❌"}`);

  // ── 4. A real licence owner claims ──
  await network.provider.send("evm_increaseTime", [DAY]);
  await network.provider.send("evm_mine");

  console.log("\n── Chủ licence thật rút ──");
  for (let id = 0; id < Number(n); id++) {
    const holder = await mp.licenceOwner(id);
    const pending = await mp.pendingOf(id);
    console.log(`  licence #${id}  chủ ${holder.slice(0, 10)}…  chờ rút ${f(pending)} MIC`);

    await network.provider.send("hardhat_impersonateAccount", [holder]);
    await network.provider.send("hardhat_setBalance", [holder, "0x56BC75E2D63100000"]);
    const h = await ethers.getSigner(holder);
    const bal0 = await mic.balanceOf(holder);
    await (await mp.connect(h).claim([id])).wait();
    const got = (await mic.balanceOf(holder)) - bal0;
    console.log(`            rút được ${f(got)} MIC  ${got > 0n ? "✅" : "❌ KHÔNG RÚT ĐƯỢC"}`);
  }

  // ── 5. Scale check at the design ceiling ──
  console.log("\n── Ở quy mô đầy 100.000 licence ──");
  const N = 100_000n;
  const rate = await v2.micPerLicencePerDay();
  const minersDaily = N * rate;

  // Today the Early Staking Boost holds miners at 49%, so issuance runs high. Projecting
  // that rate across all 360 days would overstate the total by ~0.9B and read as a pool
  // breach that does not exist — the boost expires on day 90. Integrate the ramp instead.
  let total = 0n;
  for (let d = 0; d < 360; d++) {
    const bps = d >= 90 ? 5900n : 5900n - ((BigInt(90 - d) * 1000n) / 90n);
    total += (minersDaily * 10_000n) / bps;
  }
  const steady = (minersDaily * 10_000n) / 5900n;
  const boosted = await v2.emissionFor(100_000, DAY);
  const remaining = await mic.remainingMiningPool();

  console.log(`  phát hành/ngày hôm nay ${f(boosted, 0)} MIC  (miners ở ${await v2.currentMinerBps()} bps — còn boost)`);
  console.log(`  phát hành/ngày ổn định ${f(steady, 0)} MIC  (sau ngày 90, miners 5900 bps)`);
  console.log(`  miners/ngày            ${f(minersDaily, 0)} MIC  ← không đổi, boost hay không`);
  console.log(`  trọn kỳ 360 ngày       ${f(total / 1_000_000_000n, 3)} tỷ MIC phát hành`);
  console.log(`    trong đó tới miners  ${f(minersDaily * 360n / 1_000_000_000n, 3)} tỷ`);
  console.log(`    phụ trội do boost    ${f((total - steady * 360n) / 1_000_000n, 0)} triệu`);
  console.log(`  quỹ đào                ${f(remaining, 0)} MIC`);
  console.log(`  vừa quỹ                ${total < remaining ? `✅ dư ${f((remaining - total) / 1_000_000n, 0)} triệu` : "❌ THIẾU"}`);
  console.log(`  (ngoại suy sai nếu lấy tốc độ boost cho cả kỳ: ${f(boosted * 360n / 1_000_000_000n, 2)} tỷ — không phải con số thật)`);

  console.log("\n═══ Diễn tập xong — không có gì chạm mainnet ═══\n");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
