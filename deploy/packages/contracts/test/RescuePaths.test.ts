import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Every contract in the PreSale deploy set must be able to send back a token that
 * arrives by mistake. `TreasuryManager` v1 could not, and 105,000,000 MIC is stranded
 * there permanently. None of these contracts is upgradeable, so a rescue path that is
 * missing at deploy is missing for good.
 *
 * Two rules, applied per contract rather than uniformly:
 *   · Pass-through contracts hold nothing by design, so anything resting in them is a
 *     stray deposit and may be recovered in full.
 *   · Contracts where users are owed USDT must refuse to rescue USDT. An admin path to
 *     money that belongs to someone else is a worse defect than a stranded token.
 */

const usdt6 = (n: string | number) => ethers.parseUnits(String(n), 6);
const e18 = (n: string | number) => ethers.parseEther(String(n));

describe("Rescue paths — PreSale deploy set", () => {
  let admin: SignerWithAddress, stranger: SignerWithAddress, dest: SignerWithAddress;
  let usdt: any, stray: any;

  beforeEach(async () => {
    [admin, stranger, dest] = await ethers.getSigners();
    usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
    stray = await (await ethers.getContractFactory("MockUSDT")).deploy();
  });

  /** Deploy each contract with whatever constructor it happens to take. */
  async function build(name: string) {
    const U = await usdt.getAddress();
    const F = await ethers.getContractFactory(name);
    switch (name) {
      case "ReferralRegistry":    return F.deploy(U, admin.address);
      case "ListingReserve":      return F.deploy(U, admin.address);
      case "ManagementPool":      return F.deploy(U, Array(6).fill(admin.address), admin.address);
      case "NFTRewardPool":       return F.deploy(U, admin.address, "Weekly", 8000);
      case "CommunityNFTv2":      return F.deploy(admin.address);
      case "RewardDistributorV2": {
        const claim = await (await ethers.getContractFactory("MockRewardReceiver")).deploy(U);
        return F.deploy(U, await claim.getAddress(), await claim.getAddress(),
                        await claim.getAddress(), await claim.getAddress(), admin.address);
      }
      case "RevenueRouter": {
        const r = await (await ethers.getContractFactory("MockRewardReceiver")).deploy(U);
        const a = await r.getAddress();
        // _usdt, _referral, _marketing, _management, _treasury, _reservedStaking, _liquidity, _admin
        return F.deploy(U, admin.address, a, a, a, a, a, admin.address);
      }
      default: throw new Error("unknown " + name);
    }
  }

  const ALL = ["ReferralRegistry", "RewardDistributorV2", "RevenueRouter",
               "ListingReserve", "ManagementPool", "NFTRewardPool", "CommunityNFTv2"];
  const USDT_PROTECTED = ["ListingReserve", "ManagementPool", "NFTRewardPool"];

  for (const name of ALL) {
    describe(name, () => {
      it("recovers a foreign token sent by mistake", async () => {
        const c: any = await build(name);
        await stray.mint(await c.getAddress(), usdt6(1234));
        await c.connect(admin).rescueToken(await stray.getAddress(), dest.address, usdt6(1234));
        expect(await stray.balanceOf(dest.address)).to.equal(usdt6(1234));
      });

      it("is admin-gated", async () => {
        const c: any = await build(name);
        await stray.mint(await c.getAddress(), usdt6(10));
        await expect(
          c.connect(stranger).rescueToken(await stray.getAddress(), stranger.address, usdt6(10)),
        ).to.be.reverted;
      });

      it("rejects a zero recipient and a zero amount", async () => {
        const c: any = await build(name);
        await stray.mint(await c.getAddress(), usdt6(10));
        await expect(c.connect(admin).rescueToken(await stray.getAddress(), ethers.ZeroAddress, usdt6(1)))
          .to.be.revertedWith(/zero recipient/);
        await expect(c.connect(admin).rescueToken(await stray.getAddress(), dest.address, 0))
          .to.be.revertedWith(/zero amount/);
      });

      if (USDT_PROTECTED.includes(name)) {
        it("refuses to rescue USDT — it is owed to someone", async () => {
          const c: any = await build(name);
          await usdt.mint(await c.getAddress(), usdt6(500));
          await expect(c.connect(admin).rescueToken(await usdt.getAddress(), dest.address, usdt6(1)))
            .to.be.revertedWith(/usdt has its own path/);
        });
      } else {
        it("recovers USDT too — nothing rests here by design", async () => {
          const c: any = await build(name);
          await usdt.mint(await c.getAddress(), usdt6(500));
          await c.connect(admin).rescueToken(await usdt.getAddress(), dest.address, usdt6(500));
          expect(await usdt.balanceOf(dest.address)).to.equal(usdt6(500));
        });
      }
    });
  }

  it("no contract in the set is left without a rescue path", async () => {
    for (const name of ALL) {
      const c: any = await build(name);
      const names = c.interface.fragments
        .filter((f: any) => f.type === "function")
        .map((f: any) => f.name);
      expect(names, `${name} has no rescueToken`).to.include("rescueToken");
    }
  });
});
