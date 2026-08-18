import { expect } from "chai";
import { ethers } from "hardhat";

// Deck p.17 (rev 2026-07): Marketing 25% bucket splits (BPS of the bucket)
//   Claim 4200 (10.5% gross) · Weekly 2200 (5.5%) · Monthly 3200 (8%) · Lucky 400 (1%)
const BPS = { claim: 4200n, weekly: 2200n, monthly: 3200n, lucky: 400n };
const WEEKLY_COMMUNITY_BPS = 9091n;  // NFT 5% / 5.5%
const MONTHLY_COMMUNITY_BPS = 9375n; // NFT 7.5% / 8%
const TEN_K = 10_000n;

describe("RewardDistributorV2 + NFTRewardPool (Deck p.17 reward model)", function () {
  this.timeout(120000);
  let usdt: any, dist: any, claim: any, weekly: any, monthly: any, lucky: any;
  let admin: any, router: any, u1: any, u2: any;

  const AMOUNT = 25_000n * 10n ** 6n; // $25,000 = Marketing 25% of a $100k gross batch

  beforeEach(async () => {
    [admin, router, u1, u2] = await ethers.getSigners();
    usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
    await usdt.waitForDeployment();

    const Pool = await ethers.getContractFactory("NFTRewardPool");
    // claim & lucky slots: use a pool with communityBps=10000 as a simple sink (all in communityBalance)
    claim   = await Pool.deploy(await usdt.getAddress(), admin.address, "Claim", TEN_K);
    weekly  = await Pool.deploy(await usdt.getAddress(), admin.address, "Weekly Growth", WEEKLY_COMMUNITY_BPS);
    monthly = await Pool.deploy(await usdt.getAddress(), admin.address, "Monthly Community", MONTHLY_COMMUNITY_BPS);
    lucky   = await Pool.deploy(await usdt.getAddress(), admin.address, "Lucky", TEN_K);
    for (const p of [claim, weekly, monthly, lucky]) await p.waitForDeployment();

    const D = await ethers.getContractFactory("RewardDistributorV2");
    dist = await D.deploy(
      await usdt.getAddress(),
      await claim.getAddress(),
      await weekly.getAddress(),
      await monthly.getAddress(),
      await lucky.getAddress(),
      admin.address
    );
    await dist.waitForDeployment();

    // wire roles: distributor may fund each pool; router may call the distributor
    const DR = await claim.DISTRIBUTOR_ROLE();
    for (const p of [claim, weekly, monthly, lucky]) {
      await p.connect(admin).grantRole(DR, await dist.getAddress());
    }
    await dist.connect(admin).grantRole(await dist.DISTRIBUTOR_ROLE(), router.address);

    // fund the router and approve the distributor
    await usdt.mint(router.address, AMOUNT);
    await usdt.connect(router).approve(await dist.getAddress(), AMOUNT);
  });

  it("default BPS match Deck p.17 and sum to 10000", async () => {
    expect(await dist.bpsClaim()).to.equal(BPS.claim);
    expect(await dist.bpsWeekly()).to.equal(BPS.weekly);
    expect(await dist.bpsMonthly()).to.equal(BPS.monthly);
    expect(await dist.bpsLucky()).to.equal(BPS.lucky);
    expect(BPS.claim + BPS.weekly + BPS.monthly + BPS.lucky).to.equal(TEN_K);
  });

  it("routes the 35% bucket to the 4 pools with lucky absorbing dust", async () => {
    await dist.connect(router).receiveAndDistribute(AMOUNT);

    const toClaim   = (AMOUNT * BPS.claim) / TEN_K;
    const toWeekly  = (AMOUNT * BPS.weekly) / TEN_K;
    const toMonthly = (AMOUNT * BPS.monthly) / TEN_K;
    const toLucky   = AMOUNT - toClaim - toWeekly - toMonthly;

    const total = async (p: any) => (await p.communityBalance()) + (await p.mfpBalance());
    expect(await total(claim)).to.equal(toClaim);
    expect(await total(weekly)).to.equal(toWeekly);
    expect(await total(monthly)).to.equal(toMonthly);
    expect(await total(lucky)).to.equal(toLucky);
    // nothing stuck in the distributor
    expect(await usdt.balanceOf(await dist.getAddress())).to.equal(0n);
    // conservation
    expect(toClaim + toWeekly + toMonthly + toLucky).to.equal(AMOUNT);
  });

  it("Weekly Growth splits into Community NFT + MFP slice (5% / 0.5%)", async () => {
    await dist.connect(router).receiveAndDistribute(AMOUNT);
    const toWeekly = (AMOUNT * BPS.weekly) / TEN_K;
    const community = (toWeekly * WEEKLY_COMMUNITY_BPS) / TEN_K;
    const mfp = toWeekly - community;
    expect(await weekly.communityBalance()).to.equal(community);
    expect(await weekly.mfpBalance()).to.equal(mfp);
    // MFP slice ~= 0.5/5.5 of the weekly pool
    expect(mfp * 1000n / toWeekly).to.be.closeTo(91n, 2n); // ~9.09%
  });

  it("Monthly Community splits into Community NFT + MFP slice (7.5% / 0.5%)", async () => {
    await dist.connect(router).receiveAndDistribute(AMOUNT);
    const toMonthly = (AMOUNT * BPS.monthly) / TEN_K;
    const community = (toMonthly * MONTHLY_COMMUNITY_BPS) / TEN_K;
    expect(await monthly.communityBalance()).to.equal(community);
    expect(await monthly.mfpBalance()).to.equal(toMonthly - community);
  });

  it("credits Community + MFP shares → holders claim; over-credit reverts", async () => {
    await dist.connect(router).receiveAndDistribute(AMOUNT);
    const cBal = await weekly.communityBalance();
    const mBal = await weekly.mfpBalance();
    await weekly.connect(admin).grantRole(await weekly.CREDITOR_ROLE(), admin.address);

    // Community share credited to u1 (+small to u2), MFP share credited to u1 → one claim
    await weekly.connect(admin).creditCommunity([u1.address, u2.address], [cBal - 10n, 10n]);
    await weekly.connect(admin).creditMFP([u1.address], [mBal]);
    expect(await weekly.communityBalance()).to.equal(0n);
    expect(await weekly.mfpBalance()).to.equal(0n);
    expect(await weekly.claimable(u1.address)).to.equal(cBal - 10n + mBal);

    await weekly.connect(u1).claim();
    expect(await usdt.balanceOf(u1.address)).to.equal(cBal - 10n + mBal);
    expect(await weekly.claimable(u1.address)).to.equal(0n);

    await expect(weekly.connect(admin).creditCommunity([u1.address], [1n])).to.be.reverted;
    await expect(weekly.connect(u1).claim()).to.be.revertedWith("NFTRewardPool: nothing to claim");
  });

  it("only DISTRIBUTOR_ROLE can call receiveAndDistribute", async () => {
    await expect(dist.connect(u1).receiveAndDistribute(AMOUNT)).to.be.reverted;
  });

  it("percentages equal the intended shares of the $100k gross batch", async () => {
    await dist.connect(router).receiveAndDistribute(AMOUNT);
    const gross = 100_000n * 10n ** 6n; // AMOUNT (Marketing) is 25% of this
    const totalP = async (p: any) => (await p.communityBalance()) + (await p.mfpBalance());
    // round BPS on a $25k bucket -> exact
    expect(await totalP(weekly)).to.equal(gross * 55n / 1000n);   // 5.5%
    expect(await totalP(monthly)).to.equal(gross * 8n / 100n);    // 8%
    expect(await totalP(lucky)).to.equal(gross * 1n / 100n);      // 1%
    expect(await totalP(claim)).to.equal(gross * 105n / 1000n);   // 10.5%
  });
});
