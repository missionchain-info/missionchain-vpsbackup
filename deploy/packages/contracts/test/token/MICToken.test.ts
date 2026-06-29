import { expect } from "chai";
import { ethers } from "hardhat";
import { MICToken } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MICToken", function () {
  let mic: MICToken;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let stakingContract: SignerWithAddress;
  let mockLockManager: SignerWithAddress; // will mock lockedOf

  const TOTAL_CAP = ethers.parseEther("7000000000");
  const PRE_ISSUED = ethers.parseEther("1050000000");

  beforeEach(async () => {
    [owner, user1, user2, stakingContract, mockLockManager] = await ethers.getSigners();
    const MICFactory = await ethers.getContractFactory("MICToken");
    mic = await MICFactory.deploy(owner.address);
  });

  describe("Constructor", () => {
    it("should mint 15% to deployer", async () => {
      expect(await mic.balanceOf(owner.address)).to.equal(PRE_ISSUED);
    });

    it("should set total supply cap to 7B", async () => {
      expect(await mic.cap()).to.equal(TOTAL_CAP);
    });

    it("should grant DEFAULT_ADMIN_ROLE to treasury", async () => {
      const DEFAULT_ADMIN = await mic.DEFAULT_ADMIN_ROLE();
      expect(await mic.hasRole(DEFAULT_ADMIN, owner.address)).to.be.true;
    });
  });

  describe("LockManager Integration", () => {
    it("should allow admin to set lock manager", async () => {
      await mic.setLockManager(mockLockManager.address);
      expect(await mic.lockManager()).to.equal(mockLockManager.address);
    });

    it("should block transfer of locked tokens", async () => {
      // This test requires a real LockManager — will be tested in integration
    });
  });

  describe("Approved Staking Contracts", () => {
    it("should allow admin to set approved staking contract", async () => {
      await mic.setApprovedStakingContract(stakingContract.address, true);
      expect(await mic.approvedStakingContracts(stakingContract.address)).to.be.true;
    });

    it("should allow transfer TO approved staking contract even if tokens are locked", async () => {
      // Will be tested in integration with LockManager
    });
  });

  describe("Mining", () => {
    it("should allow MINTER_ROLE to mintFromMining", async () => {
      const MINTER_ROLE = await mic.MINTER_ROLE();
      await mic.grantRole(MINTER_ROLE, owner.address);
      await mic.mintFromMining(user1.address, ethers.parseEther("1000"));
      expect(await mic.balanceOf(user1.address)).to.equal(ethers.parseEther("1000"));
    });

    it("should revert if mining pool exhausted", async () => {
      const MINTER_ROLE = await mic.MINTER_ROLE();
      await mic.grantRole(MINTER_ROLE, owner.address);
      const MINING_POOL = ethers.parseEther("5950000000");
      await expect(
        mic.mintFromMining(user1.address, MINING_POOL + 1n)
      ).to.be.revertedWith("MIC: mining pool exhausted");
    });
  });

  describe("Pausable", () => {
    it("should pause and unpause transfers", async () => {
      await mic.transfer(user1.address, ethers.parseEther("100"));
      await mic.pause();
      await expect(
        mic.transfer(user2.address, ethers.parseEther("50"))
      ).to.be.reverted;
      await mic.unpause();
      await mic.transfer(user2.address, ethers.parseEther("50"));
    });
  });
});
