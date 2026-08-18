import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ListingReserve (timelocked 5% vault)", function () {
  let usdt: any, sr: any, admin: any, router: any, dest: any, outsider: any;
  const M = (n: number) => BigInt(n) * 10n ** 6n;
  const DAY = 24 * 60 * 60;

  beforeEach(async () => {
    [admin, router, dest, outsider] = await ethers.getSigners();
    usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
    sr = await (await ethers.getContractFactory("ListingReserve")).deploy(await usdt.getAddress(), admin.address);
    await sr.connect(admin).grantRole(await sr.DISTRIBUTOR_ROLE(), router.address);
    await usdt.mint(router.address, M(100_000));
    await usdt.connect(router).approve(await sr.getAddress(), ethers.MaxUint256);
  });

  it("receives USDT (only DISTRIBUTOR)", async () => {
    await sr.connect(router).receiveUSDT(M(5_000));
    expect(await sr.balance()).to.equal(M(5_000));
    expect(await sr.totalReceived()).to.equal(M(5_000));
    await expect(sr.connect(outsider).receiveUSDT(M(1))).to.be.reverted;
  });

  it("withdrawals are timelocked: request → wait 24h → execute", async () => {
    await sr.connect(router).receiveUSDT(M(5_000));
    await sr.connect(admin).requestWithdraw(dest.address, M(3_000));

    // cannot execute before the timelock
    await expect(sr.connect(admin).executeWithdraw()).to.be.revertedWith("ListingReserve: timelock active");

    await time.increase(DAY + 1);
    await sr.connect(admin).executeWithdraw();
    expect(await usdt.balanceOf(dest.address)).to.equal(M(3_000));
    expect(await sr.balance()).to.equal(M(2_000));
  });

  it("admin can cancel a pending withdrawal; non-admin cannot request", async () => {
    await sr.connect(router).receiveUSDT(M(5_000));
    await sr.connect(admin).requestWithdraw(dest.address, M(3_000));
    await sr.connect(admin).cancelWithdraw();
    await time.increase(DAY + 1);
    await expect(sr.connect(admin).executeWithdraw()).to.be.revertedWith("ListingReserve: no pending");
    await expect(sr.connect(outsider).requestWithdraw(dest.address, M(1))).to.be.reverted;
  });
});
