import { expect } from "chai";
import { ethers } from "hardhat";

const BPS_GV = 8571n;   // 9 / 10.5
const TEN_K = 10_000n;

describe("ClaimRewardsV2 (Community Growth Award + Milestones & Incentives)", function () {
  this.timeout(120000);
  let usdt: any, cnft: any, cr: any;
  let admin: any, dist: any, u1: any, ops: any;

  const AMOUNT = 10_500n * 10n ** 6n; // $10,500 = 10.5% of a $100k gross batch

  beforeEach(async () => {
    [admin, dist, u1, ops] = await ethers.getSigners();
    usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
    await usdt.waitForDeployment();
    cnft = await (await ethers.getContractFactory("CommunityNFTv2")).deploy(admin.address);
    await cnft.waitForDeployment();
    cr = await (await ethers.getContractFactory("ClaimRewardsV2")).deploy(
      await usdt.getAddress(), await cnft.getAddress(), admin.address
    );
    await cr.waitForDeployment();

    // ClaimRewardsV2 must be able to mint milestone Community NFTs
    await cnft.connect(admin).grantRole(await cnft.MINTER_ROLE(), await cr.getAddress());
    // distributor may fund ClaimRewardsV2
    await cr.connect(admin).grantRole(await cr.DISTRIBUTOR_ROLE(), dist.address);
    await cr.connect(admin).grantRole(await cr.CREDITOR_ROLE(), admin.address); // system credits GV

    await usdt.mint(dist.address, AMOUNT);
    await usdt.connect(dist).approve(await cr.getAddress(), AMOUNT);
  });

  it("splits inflow into GV Override (9%) and Milestones & Incentives (1.5%)", async () => {
    await cr.connect(dist).receiveUSDT(AMOUNT);
    const gv = (AMOUNT * BPS_GV) / TEN_K;
    expect(await cr.gvBalance()).to.equal(gv);
    expect(await cr.miBalance()).to.equal(AMOUNT - gv);
    // GV ~ 9% of $100k, M&I ~ 1.5%
    expect(await cr.gvBalance()).to.be.closeTo(9_000n * 10n ** 6n, 5n * 10n ** 6n);
    expect(await cr.miBalance()).to.be.closeTo(1_500n * 10n ** 6n, 5n * 10n ** 6n);
  });

  it("credits GV → leader claims; M&I is DAO-distributed; over-credit reverts", async () => {
    await cr.connect(dist).receiveUSDT(AMOUNT);
    const gvBal = await cr.gvBalance();
    const miBal = await cr.miBalance();

    // GV — system credits, leader pulls
    await cr.connect(admin).creditGV([u1.address], [gvBal]);
    expect(await cr.gvClaimable(u1.address)).to.equal(gvBal);
    expect(await cr.gvBalance()).to.equal(0n);
    await cr.connect(u1).claimGV();
    expect(await usdt.balanceOf(u1.address)).to.equal(gvBal);
    expect(await cr.gvClaimable(u1.address)).to.equal(0n);

    // M&I — DAO (DEFAULT_ADMIN_ROLE) distributes in-kind fund to an ops wallet
    await cr.connect(admin).distributeMilestonesIncentives([ops.address], [miBal]);
    expect(await usdt.balanceOf(ops.address)).to.equal(miBal);
    expect(await cr.miBalance()).to.equal(0n);

    await expect(cr.connect(admin).creditGV([u1.address], [1n])).to.be.reverted; // insufficient
    await expect(cr.connect(u1).claimGV()).to.be.revertedWith("CRv2: nothing to claim");
  });

  it("mints a milestone Community NFT (Builder/Maker/Luminary)", async () => {
    await cr.connect(admin).mintMilestoneNFT(u1.address, 0); // Builder
    await cr.connect(admin).mintMilestoneNFT(u1.address, 2); // Luminary
    expect(await cnft.ownerOf(1)).to.equal(u1.address);
    expect(await cnft.tierOf(1)).to.equal(1n); // Builder
    expect(await cnft.tierOf(2)).to.equal(3n); // Luminary
  });

  it("only DISTRIBUTOR_ROLE funds; only CREDITOR credits/mints", async () => {
    await expect(cr.connect(u1).receiveUSDT(AMOUNT)).to.be.reverted;
    await expect(cr.connect(u1).creditGV([u1.address], [1n])).to.be.reverted;
    await expect(cr.connect(u1).mintMilestoneNFT(u1.address, 0)).to.be.reverted;
  });

  it("mints a rank bonus batch (White Paper §B.5.1 — e.g. Legend gets 10 × Luminary)", async () => {
    await expect(cr.connect(admin).mintRankBonus(u1.address, 3, 10))
      .to.emit(cr, "RankBonusNFTMinted")
      .withArgs(u1.address, 3n, 10n, 1n);

    // All 10 land with the holder, all Luminary, each with its own serial.
    expect(await cnft.balanceOf(u1.address)).to.equal(10n);
    expect(await cnft.activeCountOf(u1.address, 3)).to.equal(10n);
    for (let id = 1; id <= 10; id++) {
      expect(await cnft.ownerOf(id)).to.equal(u1.address);
      expect(await cnft.tierOf(id)).to.equal(3n);
    }
  });

  it("rank bonus is capped and validated, so a typo cannot mint thousands", async () => {
    const cap = await cr.MAX_RANK_BONUS_BATCH();
    await expect(cr.connect(admin).mintRankBonus(u1.address, 1, cap + 1n))
      .to.be.revertedWith("CRv2: bad quantity");
    await expect(cr.connect(admin).mintRankBonus(u1.address, 1, 0))
      .to.be.revertedWith("CRv2: bad quantity");
    await expect(cr.connect(admin).mintRankBonus(ethers.ZeroAddress, 1, 1))
      .to.be.revertedWith("CRv2: zero addr");
    // Tier validation is delegated to CommunityNFTv2.
    await expect(cr.connect(admin).mintRankBonus(u1.address, 4, 1)).to.be.reverted;
  });

  it("rank bonus needs CREDITOR_ROLE, and is a separate event from milestones", async () => {
    await expect(cr.connect(u1).mintRankBonus(u1.address, 1, 1)).to.be.reverted;
    // The two programmes must stay distinguishable in the audit trail.
    await expect(cr.connect(admin).mintRankBonus(u1.address, 1, 1))
      .to.emit(cr, "RankBonusNFTMinted")
      .and.to.not.emit(cr, "MilestoneNFTMinted");
  });

});
