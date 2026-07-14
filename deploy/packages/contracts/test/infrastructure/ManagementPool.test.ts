import { expect } from "chai";
import { ethers } from "hardhat";
import { ManagementPool, MockUSDT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ManagementPool", function () {
  let pool: ManagementPool;
  let usdt: MockUSDT;

  let admin: SignerWithAddress;
  let distributor: SignerWithAddress;

  // 6 leadership role holders
  let founder: SignerWithAddress;
  let architect: SignerWithAddress;
  let cto: SignerWithAddress;
  let socialMedia: SignerWithAddress;
  let globalTraining: SignerWithAddress;
  let techTeam: SignerWithAddress;

  let bonusRecipient: SignerWithAddress;
  let stranger: SignerWithAddress;

  // Role indices
  const ROLE_FOUNDER = 0;
  const ROLE_ARCHITECT = 1;
  const ROLE_CTO = 2;
  const ROLE_SOCIAL_MEDIA = 3;
  const ROLE_GLOBAL_TRAINING = 4;
  const ROLE_TECH_TEAM = 5;

  // BPS splits (out of 10000)
  const BPS_FOUNDER        = 2000n; // 20%
  const BPS_ARCHITECT      = 1333n; // 13.33%
  const BPS_CTO            = 667n;  // 6.67%
  const BPS_SOCIAL_MEDIA   = 667n;  // 6.67%
  const BPS_GLOBAL_TRAINING = 667n; // 6.67%
  const BPS_TECH_TEAM      = 1333n; // 13.33%
  const BPS_BONUS          = 3333n; // 33.33%

  const DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  // USDT has 6 decimals
  const USDT_DEC = 6n;
  const toUSDT = (n: number) => BigInt(n) * 10n ** USDT_DEC;

  beforeEach(async () => {
    [admin, distributor, founder, architect, cto, socialMedia, globalTraining, techTeam, bonusRecipient, stranger] =
      await ethers.getSigners();

    // Deploy MockUSDT
    const USDT = await ethers.getContractFactory("MockUSDT");
    usdt = await USDT.deploy();

    // Deploy ManagementPool
    const ManagementPoolFactory = await ethers.getContractFactory("ManagementPool");
    pool = await ManagementPoolFactory.deploy(
      await usdt.getAddress(),
      [
        founder.address,
        architect.address,
        cto.address,
        socialMedia.address,
        globalTraining.address,
        techTeam.address,
      ],
      admin.address
    );

    // Grant DISTRIBUTOR_ROLE to distributor
    await pool.connect(admin).grantRole(DISTRIBUTOR_ROLE, distributor.address);

    // Mint USDT to distributor and approve pool
    await usdt.mint(distributor.address, toUSDT(1_000_000));
    await usdt.connect(distributor).approve(await pool.getAddress(), ethers.MaxUint256);
  });

  // ─────────────────────────────────────────────────────────
  // Constructor & Initial State
  // ─────────────────────────────────────────────────────────
  describe("Constructor", () => {
    it("should set USDT address", async () => {
      expect(await pool.usdt()).to.equal(await usdt.getAddress());
    });

    it("should set role addresses correctly", async () => {
      expect(await pool.getRoleAddress(ROLE_FOUNDER)).to.equal(founder.address);
      expect(await pool.getRoleAddress(ROLE_ARCHITECT)).to.equal(architect.address);
      expect(await pool.getRoleAddress(ROLE_CTO)).to.equal(cto.address);
      expect(await pool.getRoleAddress(ROLE_SOCIAL_MEDIA)).to.equal(socialMedia.address);
      expect(await pool.getRoleAddress(ROLE_GLOBAL_TRAINING)).to.equal(globalTraining.address);
      expect(await pool.getRoleAddress(ROLE_TECH_TEAM)).to.equal(techTeam.address);
    });

    it("should grant DEFAULT_ADMIN_ROLE to admin", async () => {
      expect(await pool.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("should start with zero pending amounts for all roles", async () => {
      for (let i = 0; i < 6; i++) {
        expect(await pool.pendingAmount(i)).to.equal(0n);
      }
      expect(await pool.bonusPending()).to.equal(0n);
    });

    it("should revert on zero usdt address", async () => {
      const Factory = await ethers.getContractFactory("ManagementPool");
      await expect(
        Factory.deploy(
          ethers.ZeroAddress,
          [founder.address, architect.address, cto.address, socialMedia.address, globalTraining.address, techTeam.address],
          admin.address
        )
      ).to.be.revertedWith("ManagementPool: zero usdt");
    });

    it("should revert on zero admin address", async () => {
      const Factory = await ethers.getContractFactory("ManagementPool");
      await expect(
        Factory.deploy(
          await usdt.getAddress(),
          [founder.address, architect.address, cto.address, socialMedia.address, globalTraining.address, techTeam.address],
          ethers.ZeroAddress
        )
      ).to.be.revertedWith("ManagementPool: zero admin");
    });
  });

  // ─────────────────────────────────────────────────────────
  // receiveUSDT — Splits Correctly
  // ─────────────────────────────────────────────────────────
  describe("receiveUSDT", () => {
    it("should split 10,000 USDT to 7 pools correctly", async () => {
      const amount = toUSDT(10_000);
      await pool.connect(distributor).receiveUSDT(amount);

      // Calculate expected splits
      const founderExpected        = (amount * BPS_FOUNDER) / 10000n;
      const architectExpected      = (amount * BPS_ARCHITECT) / 10000n;
      const ctoExpected            = (amount * BPS_CTO) / 10000n;
      const socialMediaExpected    = (amount * BPS_SOCIAL_MEDIA) / 10000n;
      const globalTrainingExpected = (amount * BPS_GLOBAL_TRAINING) / 10000n;
      const techTeamExpected       = (amount * BPS_TECH_TEAM) / 10000n;
      const bonusExpected          = (amount * BPS_BONUS) / 10000n;

      expect(await pool.pendingAmount(ROLE_FOUNDER)).to.equal(founderExpected);
      expect(await pool.pendingAmount(ROLE_ARCHITECT)).to.equal(architectExpected);
      expect(await pool.pendingAmount(ROLE_CTO)).to.equal(ctoExpected);
      expect(await pool.pendingAmount(ROLE_SOCIAL_MEDIA)).to.equal(socialMediaExpected);
      expect(await pool.pendingAmount(ROLE_GLOBAL_TRAINING)).to.equal(globalTrainingExpected);
      expect(await pool.pendingAmount(ROLE_TECH_TEAM)).to.equal(techTeamExpected);
      expect(await pool.bonusPending()).to.equal(bonusExpected);
    });

    it("should transfer USDT from distributor to pool contract", async () => {
      const amount = toUSDT(1_000);
      const poolAddress = await pool.getAddress();
      const balBefore = await usdt.balanceOf(poolAddress);
      await pool.connect(distributor).receiveUSDT(amount);
      const balAfter = await usdt.balanceOf(poolAddress);
      expect(balAfter - balBefore).to.equal(amount);
    });

    it("should accumulate across multiple deposits", async () => {
      const amount1 = toUSDT(5_000);
      const amount2 = toUSDT(3_000);

      await pool.connect(distributor).receiveUSDT(amount1);
      await pool.connect(distributor).receiveUSDT(amount2);

      const total = amount1 + amount2;
      const founderExpected = (total * BPS_FOUNDER) / 10000n;
      expect(await pool.pendingAmount(ROLE_FOUNDER)).to.equal(founderExpected);
    });

    it("should emit USDTReceived event", async () => {
      const amount = toUSDT(1_000);
      await expect(pool.connect(distributor).receiveUSDT(amount))
        .to.emit(pool, "USDTReceived")
        .withArgs(amount);
    });

    it("should revert if called by non-DISTRIBUTOR", async () => {
      await expect(
        pool.connect(stranger).receiveUSDT(toUSDT(100))
      ).to.be.reverted;
    });

    it("should revert on zero amount", async () => {
      await expect(
        pool.connect(distributor).receiveUSDT(0)
      ).to.be.revertedWith("ManagementPool: zero amount");
    });

    it("total splits should not exceed deposited amount (dust accumulates in contract)", async () => {
      const amount = toUSDT(10_000);
      await pool.connect(distributor).receiveUSDT(amount);

      const totalPending =
        (await pool.pendingAmount(ROLE_FOUNDER)) +
        (await pool.pendingAmount(ROLE_ARCHITECT)) +
        (await pool.pendingAmount(ROLE_CTO)) +
        (await pool.pendingAmount(ROLE_SOCIAL_MEDIA)) +
        (await pool.pendingAmount(ROLE_GLOBAL_TRAINING)) +
        (await pool.pendingAmount(ROLE_TECH_TEAM)) +
        (await pool.bonusPending());

      // Total splits <= deposited (rounding dust stays in contract)
      expect(totalPending).to.be.lte(amount);
      // Should be very close to the full amount (within 7 wei dust)
      expect(amount - totalPending).to.be.lte(7n);
    });
  });

  // ─────────────────────────────────────────────────────────
  // claim — Role Holder Claims
  // ─────────────────────────────────────────────────────────
  describe("claim", () => {
    beforeEach(async () => {
      await pool.connect(distributor).receiveUSDT(toUSDT(10_000));
    });

    it("should allow founder to claim their accumulated USDT", async () => {
      const pending = await pool.pendingAmount(ROLE_FOUNDER);
      const balBefore = await usdt.balanceOf(founder.address);
      await pool.connect(founder).claim(ROLE_FOUNDER);
      const balAfter = await usdt.balanceOf(founder.address);
      expect(balAfter - balBefore).to.equal(pending);
    });

    it("should allow architect to claim their accumulated USDT", async () => {
      const pending = await pool.pendingAmount(ROLE_ARCHITECT);
      const balBefore = await usdt.balanceOf(architect.address);
      await pool.connect(architect).claim(ROLE_ARCHITECT);
      const balAfter = await usdt.balanceOf(architect.address);
      expect(balAfter - balBefore).to.equal(pending);
    });

    it("should reset pending to 0 after claim", async () => {
      await pool.connect(founder).claim(ROLE_FOUNDER);
      expect(await pool.pendingAmount(ROLE_FOUNDER)).to.equal(0n);
    });

    it("should emit Claimed event", async () => {
      const pending = await pool.pendingAmount(ROLE_FOUNDER);
      await expect(pool.connect(founder).claim(ROLE_FOUNDER))
        .to.emit(pool, "Claimed")
        .withArgs(ROLE_FOUNDER, founder.address, pending);
    });

    it("should revert if stranger tries to claim another role's funds", async () => {
      await expect(
        pool.connect(stranger).claim(ROLE_FOUNDER)
      ).to.be.revertedWith("ManagementPool: not role holder");
    });

    it("should revert if non-role-holder tries to claim", async () => {
      await expect(
        pool.connect(architect).claim(ROLE_FOUNDER)
      ).to.be.revertedWith("ManagementPool: not role holder");
    });

    it("should revert if nothing to claim", async () => {
      await pool.connect(founder).claim(ROLE_FOUNDER); // first claim
      await expect(
        pool.connect(founder).claim(ROLE_FOUNDER) // second claim — empty
      ).to.be.revertedWith("ManagementPool: nothing to claim");
    });

    it("should accumulate across multiple deposits before claiming", async () => {
      await pool.connect(distributor).receiveUSDT(toUSDT(5_000));
      // Total deposits = 10,000 + 5,000 = 15,000
      const total = toUSDT(15_000);
      const expectedFounder = (total * BPS_FOUNDER) / 10000n;
      const balBefore = await usdt.balanceOf(founder.address);
      await pool.connect(founder).claim(ROLE_FOUNDER);
      const balAfter = await usdt.balanceOf(founder.address);
      expect(balAfter - balBefore).to.equal(expectedFounder);
    });

    it("should allow each role to independently claim", async () => {
      const roles = [
        { idx: ROLE_FOUNDER, signer: founder },
        { idx: ROLE_ARCHITECT, signer: architect },
        { idx: ROLE_CTO, signer: cto },
        { idx: ROLE_SOCIAL_MEDIA, signer: socialMedia },
        { idx: ROLE_GLOBAL_TRAINING, signer: globalTraining },
        { idx: ROLE_TECH_TEAM, signer: techTeam },
      ];

      for (const { idx, signer } of roles) {
        const pending = await pool.pendingAmount(idx);
        expect(pending).to.be.gt(0n);
        const balBefore = await usdt.balanceOf(signer.address);
        await pool.connect(signer).claim(idx);
        const balAfter = await usdt.balanceOf(signer.address);
        expect(balAfter - balBefore).to.equal(pending);
      }
    });
  });

  // ─────────────────────────────────────────────────────────
  // Bonus Pool — Admin Distribution
  // ─────────────────────────────────────────────────────────
  describe("distributeBonus", () => {
    beforeEach(async () => {
      await pool.connect(distributor).receiveUSDT(toUSDT(10_000));
    });

    it("should allow admin to distribute bonus to any address", async () => {
      const bonusAmt = await pool.bonusPending();
      const balBefore = await usdt.balanceOf(bonusRecipient.address);
      await pool.connect(admin).distributeBonus(bonusRecipient.address, bonusAmt);
      const balAfter = await usdt.balanceOf(bonusRecipient.address);
      expect(balAfter - balBefore).to.equal(bonusAmt);
    });

    it("should reduce bonusPending after distribution", async () => {
      const bonusAmt = await pool.bonusPending();
      await pool.connect(admin).distributeBonus(bonusRecipient.address, bonusAmt);
      expect(await pool.bonusPending()).to.equal(0n);
    });

    it("should allow partial bonus distribution", async () => {
      const bonusAmt = await pool.bonusPending();
      const half = bonusAmt / 2n;
      await pool.connect(admin).distributeBonus(bonusRecipient.address, half);
      expect(await pool.bonusPending()).to.equal(bonusAmt - half);
    });

    it("should emit BonusDistributed event", async () => {
      const bonusAmt = await pool.bonusPending();
      await expect(pool.connect(admin).distributeBonus(bonusRecipient.address, bonusAmt))
        .to.emit(pool, "BonusDistributed")
        .withArgs(bonusRecipient.address, bonusAmt);
    });

    it("should revert if non-admin tries to distribute bonus", async () => {
      const bonusAmt = await pool.bonusPending();
      await expect(
        pool.connect(stranger).distributeBonus(bonusRecipient.address, bonusAmt)
      ).to.be.reverted;
    });

    it("should revert if amount exceeds bonusPending", async () => {
      const bonusAmt = await pool.bonusPending();
      await expect(
        pool.connect(admin).distributeBonus(bonusRecipient.address, bonusAmt + 1n)
      ).to.be.revertedWith("ManagementPool: exceeds bonus pending");
    });

    it("should revert on zero recipient", async () => {
      await expect(
        pool.connect(admin).distributeBonus(ethers.ZeroAddress, 1n)
      ).to.be.revertedWith("ManagementPool: zero recipient");
    });

    it("should revert on zero amount", async () => {
      await expect(
        pool.connect(admin).distributeBonus(bonusRecipient.address, 0n)
      ).to.be.revertedWith("ManagementPool: zero amount");
    });
  });

  // ─────────────────────────────────────────────────────────
  // setRoleAddress — Admin Changes Role Holder
  // ─────────────────────────────────────────────────────────
  describe("setRoleAddress", () => {
    it("should allow admin to change role address", async () => {
      await pool.connect(admin).setRoleAddress(ROLE_FOUNDER, stranger.address);
      expect(await pool.getRoleAddress(ROLE_FOUNDER)).to.equal(stranger.address);
    });

    it("should emit RoleAddressUpdated event", async () => {
      await expect(pool.connect(admin).setRoleAddress(ROLE_FOUNDER, stranger.address))
        .to.emit(pool, "RoleAddressUpdated")
        .withArgs(ROLE_FOUNDER, founder.address, stranger.address);
    });

    it("should revert if non-admin tries to change role address", async () => {
      await expect(
        pool.connect(stranger).setRoleAddress(ROLE_FOUNDER, stranger.address)
      ).to.be.reverted;
    });

    it("should revert on zero new address", async () => {
      await expect(
        pool.connect(admin).setRoleAddress(ROLE_FOUNDER, ethers.ZeroAddress)
      ).to.be.revertedWith("ManagementPool: zero address");
    });

    it("should allow new role holder to claim after address change", async () => {
      await pool.connect(distributor).receiveUSDT(toUSDT(10_000));
      await pool.connect(admin).setRoleAddress(ROLE_FOUNDER, stranger.address);

      const pending = await pool.pendingAmount(ROLE_FOUNDER);
      const balBefore = await usdt.balanceOf(stranger.address);
      await pool.connect(stranger).claim(ROLE_FOUNDER);
      const balAfter = await usdt.balanceOf(stranger.address);
      expect(balAfter - balBefore).to.equal(pending);
    });

    it("old role holder cannot claim after address change", async () => {
      await pool.connect(distributor).receiveUSDT(toUSDT(10_000));
      await pool.connect(admin).setRoleAddress(ROLE_FOUNDER, stranger.address);

      await expect(
        pool.connect(founder).claim(ROLE_FOUNDER)
      ).to.be.revertedWith("ManagementPool: not role holder");
    });
  });

  // ─────────────────────────────────────────────────────────
  // Access Control — DISTRIBUTOR_ROLE
  // ─────────────────────────────────────────────────────────
  describe("Access Control", () => {
    it("should grant DISTRIBUTOR_ROLE via admin", async () => {
      expect(await pool.hasRole(DISTRIBUTOR_ROLE, distributor.address)).to.be.true;
    });

    it("should allow admin to revoke DISTRIBUTOR_ROLE", async () => {
      await pool.connect(admin).revokeRole(DISTRIBUTOR_ROLE, distributor.address);
      await expect(
        pool.connect(distributor).receiveUSDT(toUSDT(100))
      ).to.be.reverted;
    });

    it("should allow admin to grant DISTRIBUTOR_ROLE to new address", async () => {
      await pool.connect(admin).grantRole(DISTRIBUTOR_ROLE, stranger.address);
      await usdt.mint(stranger.address, toUSDT(100));
      await usdt.connect(stranger).approve(await pool.getAddress(), toUSDT(100));
      await expect(pool.connect(stranger).receiveUSDT(toUSDT(100))).to.not.be.reverted;
    });
  });

  // ─────────────────────────────────────────────────────────
  // View Functions
  // ─────────────────────────────────────────────────────────
  describe("View Functions", () => {
    it("totalReceived should track cumulative USDT received", async () => {
      await pool.connect(distributor).receiveUSDT(toUSDT(1_000));
      await pool.connect(distributor).receiveUSDT(toUSDT(2_000));
      expect(await pool.totalReceived()).to.equal(toUSDT(3_000));
    });

    it("getRoleBps should return correct BPS for each role", async () => {
      expect(await pool.getRoleBps(ROLE_FOUNDER)).to.equal(BPS_FOUNDER);
      expect(await pool.getRoleBps(ROLE_ARCHITECT)).to.equal(BPS_ARCHITECT);
      expect(await pool.getRoleBps(ROLE_CTO)).to.equal(BPS_CTO);
      expect(await pool.getRoleBps(ROLE_SOCIAL_MEDIA)).to.equal(BPS_SOCIAL_MEDIA);
      expect(await pool.getRoleBps(ROLE_GLOBAL_TRAINING)).to.equal(BPS_GLOBAL_TRAINING);
      expect(await pool.getRoleBps(ROLE_TECH_TEAM)).to.equal(BPS_TECH_TEAM);
    });

    it("BONUS_BPS should return correct bonus BPS", async () => {
      expect(await pool.BONUS_BPS()).to.equal(BPS_BONUS);
    });
  });
});
