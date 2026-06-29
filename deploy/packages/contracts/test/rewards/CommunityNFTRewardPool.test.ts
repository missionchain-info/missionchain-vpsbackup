import { expect } from "chai";
import { ethers } from "hardhat";

describe("CommunityNFTRewardPool", function () {
  let pool: any;
  let mic: any;
  let admin: any;
  let distributor: any;
  let user1: any;
  let user2: any;
  let user3: any;

  beforeEach(async () => {
    [admin, distributor, user1, user2, user3] = await ethers.getSigners();

    // Deploy MICToken
    const MICFactory = await ethers.getContractFactory("MICToken");
    mic = await MICFactory.deploy(admin.address);

    // Deploy CommunityNFTRewardPool
    const PoolFactory = await ethers.getContractFactory("CommunityNFTRewardPool");
    pool = await PoolFactory.deploy(await mic.getAddress(), admin.address);

    // Grant DISTRIBUTOR_ROLE to distributor signer
    const DIST_ROLE = await pool.DISTRIBUTOR_ROLE();
    await pool.connect(admin).grantRole(DIST_ROLE, distributor.address);

    // Fund the pool with 1,000,000 MIC
    await mic.connect(admin).transfer(await pool.getAddress(), ethers.parseEther("1000000"));
  });

  describe("Constructor", () => {
    it("should reject zero addresses", async () => {
      const PoolFactory = await ethers.getContractFactory("CommunityNFTRewardPool");
      await expect(PoolFactory.deploy(ethers.ZeroAddress, admin.address)).to.be.revertedWith("Pool: zero address");
      await expect(PoolFactory.deploy(await mic.getAddress(), ethers.ZeroAddress)).to.be.revertedWith("Pool: zero address");
    });

    it("should grant DEFAULT_ADMIN_ROLE and DISTRIBUTOR_ROLE to admin", async () => {
      const ADMIN_ROLE = await pool.DEFAULT_ADMIN_ROLE();
      const DIST_ROLE = await pool.DISTRIBUTOR_ROLE();
      expect(await pool.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
      expect(await pool.hasRole(DIST_ROLE, admin.address)).to.be.true;
    });
  });

  describe("balance()", () => {
    it("should return current MIC balance", async () => {
      expect(await pool.balance()).to.equal(ethers.parseEther("1000000"));
    });
  });

  describe("distribute()", () => {
    it("should distribute MIC to recipients and emit events", async () => {
      const recipients = [user1.address, user2.address, user3.address];
      const amounts = [ethers.parseEther("100"), ethers.parseEther("200"), ethers.parseEther("300")];

      await expect(pool.connect(distributor).distribute(recipients, amounts))
        .to.emit(pool, "BatchDistributed")
        .withArgs(0n, 3n, ethers.parseEther("600"));

      expect(await mic.balanceOf(user1.address)).to.equal(ethers.parseEther("100"));
      expect(await mic.balanceOf(user2.address)).to.equal(ethers.parseEther("200"));
      expect(await mic.balanceOf(user3.address)).to.equal(ethers.parseEther("300"));
      expect(await pool.totalDistributed()).to.equal(ethers.parseEther("600"));
      expect(await pool.distributionCount()).to.equal(1n);
    });

    it("should increment epoch on each distribution", async () => {
      await pool.connect(distributor).distribute([user1.address], [ethers.parseEther("100")]);
      await pool.connect(distributor).distribute([user2.address], [ethers.parseEther("200")]);
      expect(await pool.distributionCount()).to.equal(2n);
      expect(await pool.totalDistributed()).to.equal(ethers.parseEther("300"));
    });

    it("should revert if length mismatch", async () => {
      await expect(
        pool.connect(distributor).distribute([user1.address, user2.address], [ethers.parseEther("100")])
      ).to.be.revertedWith("Pool: length mismatch");
    });

    it("should revert if empty recipients", async () => {
      await expect(pool.connect(distributor).distribute([], [])).to.be.revertedWith("Pool: empty recipients");
    });

    it("should revert on zero recipient", async () => {
      await expect(
        pool.connect(distributor).distribute([ethers.ZeroAddress], [ethers.parseEther("100")])
      ).to.be.revertedWith("Pool: zero recipient");
    });

    it("should revert if caller lacks DISTRIBUTOR_ROLE", async () => {
      await expect(pool.connect(user1).distribute([user2.address], [ethers.parseEther("100")])).to.be.reverted;
    });
  });

  describe("emergencyWithdraw()", () => {
    it("should allow admin to withdraw", async () => {
      await expect(pool.connect(admin).emergencyWithdraw(user1.address, ethers.parseEther("500000")))
        .to.emit(pool, "EmergencyWithdraw")
        .withArgs(user1.address, ethers.parseEther("500000"));
      expect(await mic.balanceOf(user1.address)).to.equal(ethers.parseEther("500000"));
    });

    it("should revert on zero address", async () => {
      await expect(
        pool.connect(admin).emergencyWithdraw(ethers.ZeroAddress, ethers.parseEther("100"))
      ).to.be.revertedWith("Pool: zero address");
    });

    it("should revert if caller is not admin", async () => {
      await expect(
        pool.connect(distributor).emergencyWithdraw(user1.address, ethers.parseEther("100"))
      ).to.be.reverted;
    });
  });
});
