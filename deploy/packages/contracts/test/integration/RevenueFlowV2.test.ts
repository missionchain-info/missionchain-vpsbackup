import { expect } from "chai";
import { ethers } from "hardhat";

// End-to-end proof of the revised money flow (all % of GROSS, 100% input):
//   Referral 10% · Marketing 25% (Claim 10.5 / Weekly 5.5 / Monthly 8 / Lucky 1)
//   Management 7.5% · Treasury 12.5% · Staking 5% · Liquidity 40% = 100%
describe("Revenue flow V2 — integration (all % of gross)", function () {
  this.timeout(180000);
  const M = (n: number) => BigInt(n) * 10n ** 6n; // USDT 6-dec helper
  const GROSS = M(100_000); // $100,000 purchase batch → round numbers

  let usdt: any, cnft: any, claim: any, weekly: any, monthly: any, lucky: any;
  let dist: any, registry: any, router: any;
  let admin: any, sale: any, buyer: any, f1: any, f2: any;
  let mgmt: any, treasury: any, staking: any, liquidity: any;

  beforeEach(async () => {
    [admin, sale, buyer, f1, f2] = await ethers.getSigners();
    const F = (n: string) => ethers.getContractFactory(n);

    usdt = await (await F("MockUSDT")).deploy();
    cnft = await (await F("CommunityNFTv2")).deploy(admin.address);
    claim = await (await F("ClaimRewardsV2")).deploy(await usdt.getAddress(), await cnft.getAddress(), admin.address);
    weekly = await (await F("NFTRewardPool")).deploy(await usdt.getAddress(), admin.address, "Weekly Growth", 9091);
    monthly = await (await F("NFTRewardPool")).deploy(await usdt.getAddress(), admin.address, "Monthly Community", 9375);
    lucky = await (await F("LuckyDraw")).deploy(await usdt.getAddress(), admin.address);
    // Infra pools are CONTRACTS (router calls receiveUSDT). Use MockRewardReceiver stand-ins.
    const MR = await F("MockRewardReceiver");
    mgmt = await (await MR).deploy(await usdt.getAddress());
    treasury = await (await MR).deploy(await usdt.getAddress());
    staking = await (await MR).deploy(await usdt.getAddress());
    liquidity = await (await MR).deploy(await usdt.getAddress());
    dist = await (await F("RewardDistributorV2")).deploy(
      await usdt.getAddress(), await claim.getAddress(), await weekly.getAddress(),
      await monthly.getAddress(), await lucky.getAddress(), admin.address);
    registry = await (await F("ReferralRegistry")).deploy(await usdt.getAddress(), admin.address);
    router = await (await F("RevenueRouter")).deploy(
      await usdt.getAddress(), await registry.getAddress(), await dist.getAddress(),
      await mgmt.getAddress(), await treasury.getAddress(), await staking.getAddress(),
      await liquidity.getAddress(), admin.address);

    // ── Wire roles ──
    const DR = await dist.DISTRIBUTOR_ROLE();
    await router.connect(admin).grantRole(await router.DISTRIBUTOR_ROLE(), sale.address); // sale drives the router
    await dist.connect(admin).grantRole(DR, await router.getAddress());                   // router funds the distributor
    for (const p of [claim, weekly, monthly, lucky]) {
      await p.connect(admin).grantRole(await p.DISTRIBUTOR_ROLE(), await dist.getAddress()); // distributor funds pools
    }
    await registry.connect(admin).grantRole(await registry.CALLER_ROLE(), sale.address);   // sale triggers referral
    await registry.connect(admin).setIncentivePool(await claim.getAddress());              // unspent referral → M&I
    await claim.connect(admin).grantRole(await claim.OVERFLOW_ROLE(), await registry.getAddress());

    await usdt.mint(sale.address, GROSS * 2n);
  });

  async function runSale(theBuyer: string, amount: bigint) {
    await usdt.connect(sale).approve(await router.getAddress(), amount);
    await router.connect(sale).receiveAndDistribute(amount);   // 6-way gross split
    await registry.connect(sale).distributeReferral(theBuyer, amount); // per-buyer F1/F2 + overflow
  }

  it("splits a $100k purchase exactly by gross %, with F1/F2 paid", async () => {
    await registry.connect(sale).setReferrer(buyer.address, f1.address);
    await registry.connect(sale).setReferrer(f1.address, f2.address);

    await runSale(buyer.address, GROSS);

    // Referral 10%: F1 7% + F2 3%
    expect(await usdt.balanceOf(f1.address)).to.equal(M(7_000));  // 7%
    expect(await usdt.balanceOf(f2.address)).to.equal(M(3_000));  // 3%

    // Infra buckets (pushed)
    expect(await mgmt.received()).to.equal(M(7_500));      // 7.5%
    expect(await treasury.received()).to.equal(M(12_500)); // 12.5%
    expect(await staking.received()).to.equal(M(5_000));   // 5%
    expect(await liquidity.received()).to.equal(M(40_000)); // 40%

    // Marketing 25% → 4 reward pools
    expect(await usdt.balanceOf(await weekly.getAddress())).to.equal(M(5_500));  // 5.5%
    expect(await usdt.balanceOf(await monthly.getAddress())).to.equal(M(8_000)); // 8%
    expect(await usdt.balanceOf(await lucky.getAddress())).to.equal(M(1_000));   // 1%
    expect((await claim.gvBalance()) + (await claim.miBalance())).to.equal(M(10_500)); // 10.5%

    // GV ~9% + M&I ~1.5% (8571 internal rounding)
    expect(await claim.gvBalance()).to.be.closeTo(M(9_000), M(1));
    expect(await claim.miBalance()).to.be.closeTo(M(1_500), M(1));

    // Conservation: nothing stuck in router / distributor / registry
    expect(await usdt.balanceOf(await router.getAddress())).to.equal(0n);
    expect(await usdt.balanceOf(await dist.getAddress())).to.equal(0n);
    expect(await usdt.balanceOf(await registry.getAddress())).to.equal(0n);
  });

  it("no referrer → the full 10% referral overflows into Milestones & Incentives", async () => {
    // buyer has NO referrer
    const miBefore = await claim.miBalance();
    await runSale(buyer.address, GROSS);
    // M&I = 1.5% base (from marketing) + 10% referral overflow = 11.5% of gross
    expect(await claim.miBalance()).to.be.closeTo(miBefore + M(11_500), M(1));
    expect(await usdt.balanceOf(f1.address)).to.equal(0n);
    // GV still ~9%
    expect(await claim.gvBalance()).to.be.closeTo(M(9_000), M(1));
  });

  it("F1 only (no F2) → F1 gets 7%, the 3% F2 share overflows to M&I", async () => {
    await registry.connect(sale).setReferrer(buyer.address, f1.address); // f1 has no upline
    await runSale(buyer.address, GROSS);
    expect(await usdt.balanceOf(f1.address)).to.equal(M(7_000));
    // M&I = 1.5% base + 3% overflow = 4.5%
    expect(await claim.miBalance()).to.be.closeTo(M(4_500), M(1));
  });
});
