import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

/**
 * RankBonusClaim — the member mints their own Community Growth Award batch.
 *
 * The property worth guarding is not "the right people get NFTs" — the contract cannot
 * know that, because rank is group volume computed off chain. It is that an award, once
 * recorded, is minted **once**, to the wallet it was recorded against, in the published
 * quantity. These tests are aimed there.
 */

const RANK = { NONE: 0, BUILDER: 1, CONNECTOR: 2, CHAMPION: 3, AMBASSADOR: 4, LEGEND: 5 };
const TIER = { BUILDER: 1, MAKER: 2, LUMINARY: 3 };

async function fixture() {
  const [admin, keeper, member, other, stranger] = await ethers.getSigners();

  const usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
  const cnft = await (await ethers.getContractFactory("CommunityNFTv2")).deploy(admin.address);
  const claimRewards: any = await (await ethers.getContractFactory("ClaimRewardsV2"))
    .deploy(await usdt.getAddress(), await cnft.getAddress(), admin.address);

  const rbc: any = await (await ethers.getContractFactory("RankBonusClaim"))
    .deploy(await claimRewards.getAddress(), admin.address);

  // The chain of authority the DApp button depends on:
  //   member -> RankBonusClaim -> ClaimRewardsV2 -> CommunityNFTv2
  await claimRewards.connect(admin).grantRole(
    await claimRewards.CREDITOR_ROLE(), await rbc.getAddress(),
  );
  await cnft.connect(admin).grantRole(
    await cnft.MINTER_ROLE(), await claimRewards.getAddress(),
  );
  await rbc.connect(admin).grantRole(await rbc.AWARDER_ROLE(), keeper.address);

  return { admin, keeper, member, other, stranger, rbc, claimRewards, cnft, usdt };
}

describe("RankBonusClaim", () => {
  describe("the published rank table", () => {
    it("matches White Paper §B.5.1", async () => {
      const { rbc } = await loadFixture(fixture);
      const expected: Array<[number, number, number]> = [
        [RANK.BUILDER, TIER.BUILDER, 3],
        [RANK.CONNECTOR, TIER.MAKER, 3],
        [RANK.CHAMPION, TIER.LUMINARY, 3],
        [RANK.AMBASSADOR, TIER.LUMINARY, 5],
        [RANK.LEGEND, TIER.LUMINARY, 10],
      ];
      for (const [rank, tier, qty] of expected) {
        const a = await rbc.awardForRank(rank);
        expect(a.tier, `tier for rank ${rank}`).to.equal(tier);
        expect(a.quantity, `quantity for rank ${rank}`).to.equal(qty);
      }
    });

    it("distinguishes the three Luminary ranks by quantity, not tier", async () => {
      const { rbc } = await loadFixture(fixture);
      const champ = await rbc.awardForRank(RANK.CHAMPION);
      const amb = await rbc.awardForRank(RANK.AMBASSADOR);
      const leg = await rbc.awardForRank(RANK.LEGEND);
      expect(champ.tier).to.equal(amb.tier).to.equal(leg.tier);
      expect(champ.quantity).to.not.equal(amb.quantity);
      expect(amb.quantity).to.not.equal(leg.quantity);
    });

    it("can be revised, within a fence", async () => {
      const { rbc, admin } = await loadFixture(fixture);
      await rbc.connect(admin).setAward(RANK.BUILDER, TIER.MAKER, 4);
      const a = await rbc.awardForRank(RANK.BUILDER);
      expect(a.tier).to.equal(TIER.MAKER);
      expect(a.quantity).to.equal(4);

      // ClaimRewardsV2.MAX_RANK_BONUS_BATCH is 20; a larger figure here would only fail
      // later, further from the mistake.
      await expect(rbc.connect(admin).setAward(RANK.BUILDER, TIER.MAKER, 21))
        .to.be.revertedWith("RBC: bad quantity");
      await expect(rbc.connect(admin).setAward(RANK.BUILDER, 4, 3))
        .to.be.revertedWith("RBC: bad tier");
      await expect(rbc.connect(admin).setAward(RANK.NONE, TIER.MAKER, 3))
        .to.be.revertedWith("RBC: bad rank");
    });
  });

  describe("the member mints their own", () => {
    it("mints the batch to the caller's wallet", async () => {
      const { rbc, cnft, keeper, member } = await loadFixture(fixture);
      await rbc.connect(keeper).award(member.address, RANK.LEGEND);
      await rbc.connect(member).claim(RANK.LEGEND);

      expect(await cnft.balanceOf(member.address)).to.equal(10);
      for (let i = 0; i < 10; i++) {
        expect(await cnft.ownerOf(await cnft.tokenOfOwnerByIndex(member.address, i)))
          .to.equal(member.address);
      }
    });

    it("sends the NFTs nowhere but to msg.sender", async () => {
      // `claim` takes no recipient at all — there is no argument to be talked into
      // changing. This asserts the shape of the ABI, not just a behaviour.
      const { rbc } = await loadFixture(fixture);
      const fn = rbc.interface.getFunction("claim");
      expect(fn!.inputs.length).to.equal(1);
      expect(fn!.inputs[0].type).to.equal("uint8");
    });

    it("refuses a rank that was never awarded", async () => {
      const { rbc, member } = await loadFixture(fixture);
      await expect(rbc.connect(member).claim(RANK.LEGEND)).to.be.revertedWith("RBC: not awarded");
    });

    it("refuses a second claim of the same rank", async () => {
      const { rbc, keeper, member } = await loadFixture(fixture);
      await rbc.connect(keeper).award(member.address, RANK.BUILDER);
      await rbc.connect(member).claim(RANK.BUILDER);
      await expect(rbc.connect(member).claim(RANK.BUILDER)).to.be.revertedWith("RBC: not awarded");
    });

    it("cannot be re-opened by awarding the rank again", async () => {
      // The whole reason `claimed` is kept separately from `awarded`: a keeper re-running
      // a batch must not hand somebody a second batch of ten Luminaries.
      const { rbc, cnft, keeper, member } = await loadFixture(fixture);
      await rbc.connect(keeper).award(member.address, RANK.LEGEND);
      await rbc.connect(member).claim(RANK.LEGEND);

      await rbc.connect(keeper).award(member.address, RANK.LEGEND);
      expect(await rbc.awarded(member.address, RANK.LEGEND)).to.equal(false);
      await expect(rbc.connect(member).claim(RANK.LEGEND)).to.be.revertedWith("RBC: not awarded");
      expect(await cnft.balanceOf(member.address)).to.equal(10);
    });

    it("lets one member claim several ranks as they climb", async () => {
      const { rbc, cnft, keeper, member } = await loadFixture(fixture);
      await rbc.connect(keeper).award(member.address, RANK.BUILDER);
      await rbc.connect(member).claim(RANK.BUILDER);
      await rbc.connect(keeper).award(member.address, RANK.CONNECTOR);
      await rbc.connect(member).claim(RANK.CONNECTOR);
      expect(await cnft.balanceOf(member.address)).to.equal(6);
    });

    it("does not let one member claim another's award", async () => {
      const { rbc, keeper, member, other } = await loadFixture(fixture);
      await rbc.connect(keeper).award(member.address, RANK.CHAMPION);
      await expect(rbc.connect(other).claim(RANK.CHAMPION)).to.be.revertedWith("RBC: not awarded");
    });
  });

  describe("who may record an award", () => {
    it("only the keeper", async () => {
      const { rbc, stranger, member } = await loadFixture(fixture);
      await expect(rbc.connect(stranger).award(member.address, RANK.BUILDER)).to.be.reverted;
    });

    it("refuses a zero address and a non-rank", async () => {
      const { rbc, keeper, member } = await loadFixture(fixture);
      await expect(rbc.connect(keeper).award(ethers.ZeroAddress, RANK.BUILDER))
        .to.be.revertedWith("RBC: zero user");
      await expect(rbc.connect(keeper).award(member.address, RANK.NONE))
        .to.be.revertedWith("RBC: bad rank");
    });

    it("is idempotent, so a re-run after a crash does not fail the batch", async () => {
      const { rbc, keeper, member, other } = await loadFixture(fixture);
      await rbc.connect(keeper).awardBatch(
        [member.address, other.address], [RANK.BUILDER, RANK.CONNECTOR],
      );
      await expect(rbc.connect(keeper).awardBatch(
        [member.address, other.address], [RANK.BUILDER, RANK.CONNECTOR],
      )).to.not.be.reverted;
      expect(await rbc.awarded(member.address, RANK.BUILDER)).to.equal(true);
    });

    it("rejects mismatched batch input rather than silently truncating", async () => {
      const { rbc, keeper, member, other } = await loadFixture(fixture);
      await expect(rbc.connect(keeper).awardBatch([member.address, other.address], [RANK.BUILDER]))
        .to.be.revertedWith("RBC: bad input");
    });

    it("lets an admin — not the keeper — withdraw an unclaimed award", async () => {
      const { rbc, admin, keeper, member } = await loadFixture(fixture);
      await rbc.connect(keeper).award(member.address, RANK.LEGEND);
      await expect(rbc.connect(keeper).revokeAward(member.address, RANK.LEGEND)).to.be.reverted;
      await rbc.connect(admin).revokeAward(member.address, RANK.LEGEND);
      await expect(rbc.connect(member).claim(RANK.LEGEND)).to.be.revertedWith("RBC: not awarded");
    });
  });

  describe("what the DApp panel reads", () => {
    it("lists every claimable rank with what it pays", async () => {
      const { rbc, keeper, member } = await loadFixture(fixture);
      await rbc.connect(keeper).award(member.address, RANK.BUILDER);
      await rbc.connect(keeper).award(member.address, RANK.AMBASSADOR);

      const [ranks, tiers, quantities] = await rbc.claimableOf(member.address);
      expect(ranks.map(Number)).to.deep.equal([RANK.BUILDER, RANK.AMBASSADOR]);
      expect(tiers.map(Number)).to.deep.equal([TIER.BUILDER, TIER.LUMINARY]);
      expect(quantities.map(Number)).to.deep.equal([3, 5]);
    });

    it("drops a rank from the list once it is minted", async () => {
      const { rbc, keeper, member } = await loadFixture(fixture);
      await rbc.connect(keeper).award(member.address, RANK.BUILDER);
      await rbc.connect(member).claim(RANK.BUILDER);
      const [ranks] = await rbc.claimableOf(member.address);
      expect(ranks.length).to.equal(0);
    });

    it("is empty for a wallet that has earned nothing", async () => {
      const { rbc, stranger } = await loadFixture(fixture);
      const [ranks] = await rbc.claimableOf(stranger.address);
      expect(ranks.length).to.equal(0);
    });
  });

  describe("pause", () => {
    it("stops claiming without erasing what was earned", async () => {
      const { rbc, admin, keeper, member } = await loadFixture(fixture);
      await rbc.connect(keeper).award(member.address, RANK.CHAMPION);
      await rbc.connect(admin).setPaused(true);
      await expect(rbc.connect(member).claim(RANK.CHAMPION)).to.be.revertedWith("RBC: paused");

      await rbc.connect(admin).setPaused(false);
      await expect(rbc.connect(member).claim(RANK.CHAMPION)).to.not.be.reverted;
    });
  });

  describe("the authority chain", () => {
    it("cannot mint if CREDITOR_ROLE is taken away — and says so", async () => {
      const { rbc, claimRewards, admin, keeper, member } = await loadFixture(fixture);
      await claimRewards.connect(admin).revokeRole(
        await claimRewards.CREDITOR_ROLE(), await rbc.getAddress(),
      );
      await rbc.connect(keeper).award(member.address, RANK.BUILDER);
      await expect(rbc.connect(member).claim(RANK.BUILDER)).to.be.reverted;
    });

    it("leaves the admin's own mintRankBonus intact for awards outside the KPI programme", async () => {
      // The Owner keeps the admin button; it just means something different now.
      const { claimRewards, cnft, admin, other } = await loadFixture(fixture);
      await claimRewards.connect(admin).grantRole(await claimRewards.CREDITOR_ROLE(), admin.address);
      await claimRewards.connect(admin).mintRankBonus(other.address, TIER.MAKER, 2);
      expect(await cnft.balanceOf(other.address)).to.equal(2);
    });
  });

  describe("stray tokens", () => {
    it("can be recovered — a contract that can hold a token must be able to send it", async () => {
      const { rbc, usdt, admin, member } = await loadFixture(fixture);
      await usdt.mint(await rbc.getAddress(), ethers.parseEther("10"));
      await rbc.connect(admin).rescueToken(await usdt.getAddress(), member.address, ethers.parseEther("10"));
      expect(await usdt.balanceOf(member.address)).to.equal(ethers.parseEther("10"));
    });

    it("only by an admin", async () => {
      const { rbc, usdt, stranger } = await loadFixture(fixture);
      await expect(
        rbc.connect(stranger).rescueToken(await usdt.getAddress(), stranger.address, 1n),
      ).to.be.reverted;
    });
  });
});
