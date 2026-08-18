/**
 * EmissionControllerV2 — mainnet deploy and cutover.
 *
 * Dry-run unless EXECUTE=1. Every stage prints what it WOULD do, and stops.
 *
 *   STAGE=deploy   npx hardhat run scripts/deploy-emission-v2.ts --network bsc
 *   STAGE=cutover  npx hardhat run scripts/deploy-emission-v2.ts --network bsc
 *   STAGE=verify   npx hardhat run scripts/deploy-emission-v2.ts --network bsc
 *
 * Order matters: deploy, then cutover, then verify. `cutover` needs EC2_ADDRESS.
 */
import { ethers, network } from "hardhat";

const MIC   = "0xf27ec0c311728b923b22828002c992c799326182";
const EC_V1 = "0x37f38f383b4065BA58C7A6Fc1a91d2dF4f9f86F0";
const MP    = "0x9178292E960cb17380dd329866e725e33200e04f";

const RATE = 83_333333333333333333n;
const DAY = 86_400;
const EXECUTE = process.env.EXECUTE === "1";
const STAGE = process.env.STAGE || "deploy";

const f = (x: bigint, d = 4) => Number(ethers.formatEther(x)).toLocaleString("vi-VN", { maximumFractionDigits: d });
const say = (s: string) => console.log(s);
const would = (s: string) => console.log(`  ${EXECUTE ? "▶" : "○ SẼ"} ${s}`);

async function main() {
  const net = await ethers.provider.getNetwork();
  if (net.chainId !== 56n) throw new Error(`Sai mạng: chainId ${net.chainId}, cần 56`);

  const [signer] = await ethers.getSigners();
  say(`\n═══ EmissionControllerV2 · STAGE=${STAGE} · ${EXECUTE ? "THỰC THI" : "CHẠY KHÔ"} ═══`);
  say(`  ví ký    ${signer.address}`);
  say(`  BNB      ${f(await ethers.provider.getBalance(signer.address))}\n`);

  const mic = await ethers.getContractAt(
    ["function MINTER_ROLE() view returns(bytes32)",
     "function grantRole(bytes32,address)", "function revokeRole(bytes32,address)",
     "function hasRole(bytes32,address) view returns(bool)",
     "function remainingMiningPool() view returns(uint256)"], MIC);
  const mp = await ethers.getContractAt(
    ["function EMISSION_ROLE() view returns(bytes32)",
     "function grantRole(bytes32,address)", "function revokeRole(bytes32,address)",
     "function hasRole(bytes32,address) view returns(bool)",
     "function totalActive() view returns(uint256)"], MP);
  const v1 = await ethers.getContractAt(
    ["function stakingPool() view returns(address)", "function daoTreasury() view returns(address)",
     "function communityNFTPool() view returns(address)", "function mfpRewardPool() view returns(address)",
     "function dailyEmission() view returns(uint256)", "function totalEmitted() view returns(uint256)"], EC_V1);

  // ───────────────────────────────────────────────────────────
  if (STAGE === "deploy") {
    const [staking, dao, community, mfp] = await Promise.all([
      v1.stakingPool(), v1.daoTreasury(), v1.communityNFTPool(), v1.mfpRewardPool(),
    ]);
    const active = await mp.totalActive();
    const emitted = await v1.totalEmitted();

    say("── Hiện trạng V1 ──");
    say(`  MiningPool.totalActive  ${active}`);
    say(`  V1.totalEmitted         ${f(emitted)} MIC`);
    say(`  V1.dailyEmission        ${f(await v1.dailyEmission())} MIC/ngày`);
    if (active > 0n) say(`  → mỗi licence           ${f((await v1.dailyEmission()) * 5900n / 10000n / active)} MIC/ngày  (công bố ${f(RATE)})`);

    // V1 having paid nothing is what makes this a clean swap rather than a migration.
    if (emitted > 0n) {
      say(`\n  ⚠️  V1 ĐÃ phát hành ${f(emitted)} MIC. Không còn là thay sạch —`);
      say("     phải đối chiếu số đã trả trước khi tiếp tục. DỪNG.");
      return;
    }
    say("  V1 chưa phát hành đồng nào → thay sạch, không nợ ai\n");

    say("── Năm địa chỉ pool kế thừa từ V1 ──");
    for (const [k, v] of Object.entries({ staking, dao, community, mfp })) {
      if (v === ethers.ZeroAddress) throw new Error(`${k} là địa chỉ 0 — dừng`);
      say(`  ${k.padEnd(10)} ${v}`);
    }

    say("\n── Deploy ──");
    would(`deploy EmissionControllerV2(MIC, MiningPool, staking, dao, community, mfp, ${signer.address})`);
    if (!EXECUTE) { say("\n  Đặt EXECUTE=1 để thực thi.\n"); return; }

    const v2 = await (await ethers.getContractFactory("EmissionControllerV2")).deploy(
      MIC, MP, staking, dao, community, mfp, signer.address,
    );
    await v2.waitForDeployment();
    const addr = await v2.getAddress();
    say(`  ✅ ${addr}`);
    say(`\n  Bước sau:  EC2_ADDRESS=${addr} STAGE=cutover EXECUTE=1 npx hardhat run scripts/deploy-emission-v2.ts --network bsc`);
    say(`  Verify:    npx hardhat verify --network bsc ${addr} ${MIC} ${MP} ${staking} ${dao} ${community} ${mfp} ${signer.address}\n`);
    return;
  }

  // ───────────────────────────────────────────────────────────
  if (STAGE === "cutover") {
    const EC2 = process.env.EC2_ADDRESS;
    if (!EC2) throw new Error("Cần EC2_ADDRESS");
    const v2 = await ethers.getContractAt("EmissionControllerV2", EC2);

    say("── Kiểm tra trước khi chuyển vai ──");
    const n = await v2.activeLicences();
    say(`  V2.activeLicences        ${n}  (MiningPool.totalActive ${await mp.totalActive()})`);
    say(`  V2.micPerLicencePerDay   ${f(await v2.micPerLicencePerDay())} MIC`);
    say(`  V2.damperBps             ${await v2.damperBps()}  ${(await v2.damperBps()) === 10000n ? "(nhả — đúng)" : "⚠️ ĐANG BÓP"}`);
    say(`  V2.dailyEmission         ${f(await v2.dailyEmission())} MIC/ngày`);
    if (n > 0n) {
      const daily = BigInt(await v2.dailyEmission());
      const bps = BigInt(await v2.currentMinerBps());
      say(`  → mỗi licence            ${f((daily * bps) / 10000n / n)} MIC/ngày`);
    }

    if ((await v2.micPerLicencePerDay()) !== RATE) {
      say("\n  ⚠️  Mức thưởng khác con số công bố. DỪNG."); return;
    }

    const MINTER = await mic.MINTER_ROLE();
    const EMIT = await mp.EMISSION_ROLE();
    say("\n── Chuyển vai ──");
    would(`MICToken.grantRole(MINTER_ROLE, ${EC2})`);
    would(`MiningPool.grantRole(EMISSION_ROLE, ${EC2})`);
    would(`MICToken.revokeRole(MINTER_ROLE, ${EC_V1})`);
    would(`MiningPool.revokeRole(EMISSION_ROLE, ${EC_V1})`);
    if (!EXECUTE) { say("\n  Đặt EXECUTE=1 để thực thi.\n"); return; }

    // Grant before revoke: never leave the chain with no emitter at all.
    await (await mic.grantRole(MINTER, EC2)).wait();      say("  ✅ MINTER_ROLE → V2");
    await (await mp.grantRole(EMIT, EC2)).wait();         say("  ✅ EMISSION_ROLE → V2");
    await (await mic.revokeRole(MINTER, EC_V1)).wait();   say("  ✅ MINTER_ROLE thu khỏi V1");
    await (await mp.revokeRole(EMIT, EC_V1)).wait();      say("  ✅ EMISSION_ROLE thu khỏi V1");
    say("\n  Bước sau: bật keeper gọi distributeDaily() mỗi ngày.\n");
    return;
  }

  // ───────────────────────────────────────────────────────────
  if (STAGE === "verify") {
    const EC2 = process.env.EC2_ADDRESS;
    if (!EC2) throw new Error("Cần EC2_ADDRESS");
    const v2 = await ethers.getContractAt("EmissionControllerV2", EC2);
    const MINTER = await mic.MINTER_ROLE();
    const EMIT = await mp.EMISSION_ROLE();

    const checks: [string, boolean][] = [
      ["V2 có MINTER_ROLE trên MICToken", await mic.hasRole(MINTER, EC2)],
      ["V2 có EMISSION_ROLE trên MiningPool", await mp.hasRole(EMIT, EC2)],
      ["V1 KHÔNG còn MINTER_ROLE", !(await mic.hasRole(MINTER, EC_V1))],
      ["V1 KHÔNG còn EMISSION_ROLE", !(await mp.hasRole(EMIT, EC_V1))],
      ["mức thưởng đúng 83,3333 MIC", (await v2.micPerLicencePerDay()) === RATE],
      ["damper đang nhả", (await v2.damperBps()) === 10000n],
      ["đếm miner khớp MiningPool", (await v2.activeLicences()) <= (await mp.totalActive())],
      ["miningPool trỏ đúng", (await v2.miningPool()).toLowerCase() === MP.toLowerCase()],
    ];
    say("── Đối chiếu sau chuyển vai ──");
    let bad = 0;
    for (const [what, ok] of checks) { say(`  ${ok ? "✅" : "❌"} ${what}`); if (!ok) bad++; }

    const n = await v2.activeLicences();
    if (n > 0n) {
      const per = (BigInt(await v2.dailyEmission()) * BigInt(await v2.currentMinerBps())) / 10000n / n;
      say(`\n  mỗi licence nhận ${f(per)} MIC/ngày (công bố ${f(RATE)})`);
    }
    say(bad === 0 ? "\n  Tất cả đạt.\n" : `\n  ❌ ${bad} mục KHÔNG đạt.\n`);
    return;
  }

  throw new Error(`STAGE không hợp lệ: ${STAGE}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
