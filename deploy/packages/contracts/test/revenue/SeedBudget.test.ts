import { expect } from "chai";
import { ethers } from "hardhat";
import { SeedBudget, MockUSDT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("SeedBudget", function () {
  let seedBudget: SeedBudget;
  let usdt: MockUSDT;

  let admin: SignerWithAddress;
  let caller: SignerWithAddress;       // simulates SeedSale
  let liquidityPool: SignerWithAddress;
  let auditWallet: SignerWithAddress;
  let daoReserve: SignerWithAddress;

  // Leadership roles (7)
  let founder: SignerWithAddress;
  let architect: SignerWithAddress;
  let cto: SignerWithAddress;
  let socialMedia: SignerWithAddress;
  let techManager: SignerWithAddress;
  let agentKpiWallet: SignerWithAddress; // Agent KPI pool (20% of total)
  let bonusWallet: SignerWithAddress;    // Bonus pool (10% of total)

  let agent1: SignerWithAddress;
  let agent2: SignerWithAddress;
  let nonAdmin: SignerWithAddress;

  // ─── BPS constants (basis points out of 10_000) ───────────────────────────
  const BPS_FOUNDER       = 700n;   // 7%
  const BPS_ARCHITECT     = 500n;   // 5%
  const BPS_CTO           = 300n;   // 3%
  const BPS_SOCIAL_MEDIA  = 300n;   // 3%
  const BPS_TECH_MANAGER  = 200n;   // 2%
  const BPS_AGENT_KPI     = 2000n;  // 20%
  const BPS_BONUS         = 1000n;  // 10%

  const BPS_LIQUIDITY     = 4000n;  // 40%
  const BPS_AUDIT         = 500n;   // 5%
  const BPS_DAO_RESERVE   = 500n;   // 5%

  const USDT_6 = (n: number) => BigInt(n) * 1_000_000n;

  beforeEach(async () => {
    [
      admin, caller, liquidityPool, auditWallet, daoReserve,
      founder, architect, cto, socialMedia, techManager,
      agentKpiWallet, bonusWallet,
      agent1, agent2, nonAdmin,
    ] = await ethers.getSigners();

    // Deploy MockUSDT
    const USDT = await ethers.getContractFactory("MockUSDT");
    usdt = await USDT.deploy();

    // Deploy SeedBudget
    const Factory = await ethers.getContractFactory("SeedBudget");
    seedBudget = await Factory.deploy(
      await usdt.getAddress(),
      liquidityPool.address,
      auditWallet.address,
      daoReserve.address,
      admin.address,
      [
        founder.address,
        architect.address,
        cto.address,
        socialMedia.address,
        techManager.address,
        agentKpiWallet.address,
        bonusWallet.address,
      ]
    );

    // Grant CALLER_ROLE to caller (simulating SeedSale)
    const CALLER_ROLE = await seedBudget.CALLER_ROLE();
    await seedBudget.connect(admin).grantRole(CALLER_ROLE, caller.address);
  });

  // ─── Constructor ────────────────────────────────────────────────────────────

  describe("Constructor", () => {
    it("stores USDT address", async () => {
      expect(await seedBudget.usdt()).to.equal(await usdt.getAddress());
    });

    it("stores liquidityPool address", async () => {
      expect(await seedBudget.liquidityPool()).to.equal(liquidityPool.address);
    });

    it("stores auditWallet address", async () => {
      expect(await seedBudget.auditWallet()).to.equal(auditWallet.address);
    });

    it("stores daoReserve address", async () => {
      expect(await seedBudget.daoReserve()).to.equal(daoReserve.address);
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      const role = await seedBudget.DEFAULT_ADMIN_ROLE();
      expect(await seedBudget.hasRole(role, admin.address)).to.be.true;
    });

    it("sets leadership wallets correctly", async () => {
      expect(await seedBudget.leadershipWallet(0)).to.equal(founder.address);
      expect(await seedBudget.leadershipWallet(1)).to.equal(architect.address);
      expect(await seedBudget.leadershipWallet(2)).to.equal(cto.address);
      expect(await seedBudget.leadershipWallet(3)).to.equal(socialMedia.address);
      expect(await seedBudget.leadershipWallet(4)).to.equal(techManager.address);
      expect(await seedBudget.leadershipWallet(5)).to.equal(agentKpiWallet.address);
      expect(await seedBudget.leadershipWallet(6)).to.equal(bonusWallet.address);
    });

    it("reverts if any leadership wallet is zero address", async () => {
      const Factory = await ethers.getContractFactory("SeedBudget");
      await expect(Factory.deploy(
        await usdt.getAddress(),
        liquidityPool.address,
        auditWallet.address,
        daoReserve.address,
        admin.address,
        [
          ethers.ZeroAddress,
          architect.address,
          cto.address,
          socialMedia.address,
          techManager.address,
          agentKpiWallet.address,
          bonusWallet.address,
        ]
      )).to.be.revertedWith("SeedBudget: zero wallet");
    });
  });

  // ─── receiveAndDistribute ────────────────────────────────────────────────────

  describe("receiveAndDistribute", () => {
    const AMOUNT = USDT_6(1000); // $1,000 USDT

    beforeEach(async () => {
      // Mint USDT to caller and approve
      await usdt.mint(caller.address, AMOUNT);
      await usdt.connect(caller).approve(await seedBudget.getAddress(), AMOUNT);
    });

    it("reverts if amount is zero", async () => {
      await expect(
        seedBudget.connect(caller).receiveAndDistribute(0n)
      ).to.be.revertedWith("SeedBudget: zero amount");
    });

    it("reverts if caller lacks CALLER_ROLE", async () => {
      await expect(
        seedBudget.connect(nonAdmin).receiveAndDistribute(AMOUNT)
      ).to.be.reverted;
    });

    it("transfers USDT from caller to contract", async () => {
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
      // All USDT pulled in (pending claims or forwarded)
      const balAfter = await usdt.balanceOf(caller.address);
      expect(balAfter).to.equal(0n);
    });

    it("forwards 40% to liquidityPool immediately", async () => {
      const expected = (AMOUNT * BPS_LIQUIDITY) / 10_000n;
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
      expect(await usdt.balanceOf(liquidityPool.address)).to.equal(expected);
    });

    it("forwards 5% to auditWallet immediately", async () => {
      const expected = (AMOUNT * BPS_AUDIT) / 10_000n;
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
      expect(await usdt.balanceOf(auditWallet.address)).to.equal(expected);
    });

    it("forwards 5% to daoReserve immediately", async () => {
      const expected = (AMOUNT * BPS_DAO_RESERVE) / 10_000n;
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
      expect(await usdt.balanceOf(daoReserve.address)).to.equal(expected);
    });

    it("accumulates 7% for founder", async () => {
      const expected = (AMOUNT * BPS_FOUNDER) / 10_000n;
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
      expect(await seedBudget.pendingLeadership(0)).to.equal(expected);
    });

    it("accumulates 5% for architect", async () => {
      const expected = (AMOUNT * BPS_ARCHITECT) / 10_000n;
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
      expect(await seedBudget.pendingLeadership(1)).to.equal(expected);
    });

    it("accumulates 3% for CTO", async () => {
      const expected = (AMOUNT * BPS_CTO) / 10_000n;
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
      expect(await seedBudget.pendingLeadership(2)).to.equal(expected);
    });

    it("accumulates 3% for Social Media", async () => {
      const expected = (AMOUNT * BPS_SOCIAL_MEDIA) / 10_000n;
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
      expect(await seedBudget.pendingLeadership(3)).to.equal(expected);
    });

    it("accumulates 2% for Tech Manager", async () => {
      const expected = (AMOUNT * BPS_TECH_MANAGER) / 10_000n;
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
      expect(await seedBudget.pendingLeadership(4)).to.equal(expected);
    });

    it("accumulates 20% for Agent KPI pool", async () => {
      const expected = (AMOUNT * BPS_AGENT_KPI) / 10_000n;
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
      expect(await seedBudget.pendingLeadership(5)).to.equal(expected);
    });

    it("accumulates 10% for Bonus pool", async () => {
      const expected = (AMOUNT * BPS_BONUS) / 10_000n;
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
      expect(await seedBudget.pendingLeadership(6)).to.equal(expected);
    });

    it("total allocation equals 100% (no dust left unaccounted)", async () => {
      // 40% + 5% + 5% + 7% + 5% + 3% + 3% + 2% + 20% + 10% = 100%
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);

      const liqBal    = await usdt.balanceOf(liquidityPool.address);
      const auditBal  = await usdt.balanceOf(auditWallet.address);
      const daoBal    = await usdt.balanceOf(daoReserve.address);
      const pending0  = await seedBudget.pendingLeadership(0);
      const pending1  = await seedBudget.pendingLeadership(1);
      const pending2  = await seedBudget.pendingLeadership(2);
      const pending3  = await seedBudget.pendingLeadership(3);
      const pending4  = await seedBudget.pendingLeadership(4);
      const pending5  = await seedBudget.pendingLeadership(5);
      const pending6  = await seedBudget.pendingLeadership(6);
      const contractBal = await usdt.balanceOf(await seedBudget.getAddress());

      const totalAccounted = liqBal + auditBal + daoBal +
        pending0 + pending1 + pending2 + pending3 + pending4 + pending5 + pending6;

      // Contract balance should equal the pending claims (leadership)
      expect(contractBal).to.equal(pending0 + pending1 + pending2 + pending3 + pending4 + pending5 + pending6);
      // Total must equal AMOUNT (no USDT lost or unaccounted)
      expect(totalAccounted).to.equal(AMOUNT);
    });

    it("emits RevenueDistributed event", async () => {
      await expect(seedBudget.connect(caller).receiveAndDistribute(AMOUNT))
        .to.emit(seedBudget, "RevenueDistributed")
        .withArgs(
          AMOUNT,
          (AMOUNT * BPS_LIQUIDITY) / 10_000n,
          (AMOUNT * BPS_AUDIT) / 10_000n,
          (AMOUNT * BPS_DAO_RESERVE) / 10_000n
        );
    });

    it("accumulates across multiple distributions", async () => {
      const AMOUNT2 = USDT_6(500);
      await usdt.mint(caller.address, AMOUNT2);
      await usdt.connect(caller).approve(await seedBudget.getAddress(), AMOUNT + AMOUNT2);
      // First distribution
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
      // Second distribution
      await usdt.mint(caller.address, AMOUNT2);
      await usdt.connect(caller).approve(await seedBudget.getAddress(), AMOUNT2);
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT2);

      const expected = ((AMOUNT + AMOUNT2) * BPS_FOUNDER) / 10_000n;
      expect(await seedBudget.pendingLeadership(0)).to.equal(expected);
    });
  });

  // ─── claimLeadership ─────────────────────────────────────────────────────────

  describe("claimLeadership", () => {
    const AMOUNT = USDT_6(1000);

    beforeEach(async () => {
      await usdt.mint(caller.address, AMOUNT);
      await usdt.connect(caller).approve(await seedBudget.getAddress(), AMOUNT);
      await seedBudget.connect(caller).receiveAndDistribute(AMOUNT);
    });

    it("founder can claim their accumulated USDT", async () => {
      const pending = await seedBudget.pendingLeadership(0);
      const balBefore = await usdt.balanceOf(founder.address);
      await seedBudget.connect(founder).claimLeadership(0);
      const balAfter = await usdt.balanceOf(founder.address);
      expect(balAfter - balBefore).to.equal(pending);
    });

    it("resets pending to zero after claim", async () => {
      await seedBudget.connect(founder).claimLeadership(0);
      expect(await seedBudget.pendingLeadership(0)).to.equal(0n);
    });

    it("reverts if caller is not the role wallet", async () => {
      await expect(
        seedBudget.connect(nonAdmin).claimLeadership(0)
      ).to.be.revertedWith("SeedBudget: not wallet owner");
    });

    it("reverts if nothing to claim", async () => {
      await seedBudget.connect(founder).claimLeadership(0);
      await expect(
        seedBudget.connect(founder).claimLeadership(0)
      ).to.be.revertedWith("SeedBudget: nothing to claim");
    });

    it("emits LeadershipClaimed event", async () => {
      const pending = await seedBudget.pendingLeadership(0);
      await expect(seedBudget.connect(founder).claimLeadership(0))
        .to.emit(seedBudget, "LeadershipClaimed")
        .withArgs(0, founder.address, pending);
    });

    it("architect can claim role index 1", async () => {
      const pending = await seedBudget.pendingLeadership(1);
      await seedBudget.connect(architect).claimLeadership(1);
      expect(await usdt.balanceOf(architect.address)).to.equal(pending);
    });
  });

  // ─── Agent Management ─────────────────────────────────────────────────────

  describe("Agent Management", () => {
    it("admin can add an agent with commission BPS", async () => {
      await expect(seedBudget.connect(admin).addAgent(agent1.address, 2000n))
        .to.emit(seedBudget, "AgentAdded")
        .withArgs(agent1.address, 2000n);

      expect(await seedBudget.agentCommissionBps(agent1.address)).to.equal(2000n);
      expect(await seedBudget.isActiveAgent(agent1.address)).to.be.true;
    });

    it("reverts if non-admin tries to add agent", async () => {
      await expect(
        seedBudget.connect(nonAdmin).addAgent(agent1.address, 2000n)
      ).to.be.reverted;
    });

    it("reverts if agent address is zero", async () => {
      await expect(
        seedBudget.connect(admin).addAgent(ethers.ZeroAddress, 2000n)
      ).to.be.revertedWith("SeedBudget: zero agent");
    });

    it("reverts if commission BPS exceeds 10000", async () => {
      await expect(
        seedBudget.connect(admin).addAgent(agent1.address, 10001n)
      ).to.be.revertedWith("SeedBudget: invalid BPS");
    });

    it("admin can remove an agent", async () => {
      await seedBudget.connect(admin).addAgent(agent1.address, 2000n);
      await expect(seedBudget.connect(admin).removeAgent(agent1.address))
        .to.emit(seedBudget, "AgentRemoved")
        .withArgs(agent1.address);

      expect(await seedBudget.isActiveAgent(agent1.address)).to.be.false;
    });

    it("reverts removing non-existent agent", async () => {
      await expect(
        seedBudget.connect(admin).removeAgent(agent1.address)
      ).to.be.revertedWith("SeedBudget: not an agent");
    });

    it("reverts if non-admin tries to remove agent", async () => {
      await seedBudget.connect(admin).addAgent(agent1.address, 2000n);
      await expect(
        seedBudget.connect(nonAdmin).removeAgent(agent1.address)
      ).to.be.reverted;
    });
  });

  // ─── Agent KPI & Commission ───────────────────────────────────────────────

  describe("Agent KPI & Commission", () => {
    const SALE_AMOUNT = USDT_6(100); // $100 USDT sale
    const AGENT_COMMISSION_BPS = 2000n; // 20%

    beforeEach(async () => {
      await seedBudget.connect(admin).addAgent(agent1.address, AGENT_COMMISSION_BPS);
    });

    it("admin can record agent sale", async () => {
      await expect(seedBudget.connect(admin).recordAgentSale(agent1.address, SALE_AMOUNT))
        .to.emit(seedBudget, "AgentSaleRecorded")
        .withArgs(agent1.address, SALE_AMOUNT);
    });

    it("accumulates agent total sales", async () => {
      await seedBudget.connect(admin).recordAgentSale(agent1.address, SALE_AMOUNT);
      await seedBudget.connect(admin).recordAgentSale(agent1.address, SALE_AMOUNT);
      expect(await seedBudget.agentTotalSales(agent1.address)).to.equal(SALE_AMOUNT * 2n);
    });

    it("reverts recording sale for non-agent", async () => {
      await expect(
        seedBudget.connect(admin).recordAgentSale(agent2.address, SALE_AMOUNT)
      ).to.be.revertedWith("SeedBudget: not an agent");
    });

    it("reverts recording sale if non-admin", async () => {
      await expect(
        seedBudget.connect(nonAdmin).recordAgentSale(agent1.address, SALE_AMOUNT)
      ).to.be.reverted;
    });

    it("agent commission accumulates in pendingAgentCommission", async () => {
      // First distribute revenue so agent KPI pool has funds
      const distAmount = USDT_6(1000);
      await usdt.mint(caller.address, distAmount);
      await usdt.connect(caller).approve(await seedBudget.getAddress(), distAmount);
      await seedBudget.connect(caller).receiveAndDistribute(distAmount);

      // Admin allocates commission to agent from KPI pool
      const commission = (SALE_AMOUNT * AGENT_COMMISSION_BPS) / 10_000n;
      await expect(seedBudget.connect(admin).allocateAgentCommission(agent1.address, commission))
        .to.emit(seedBudget, "AgentCommissionAllocated")
        .withArgs(agent1.address, commission);

      expect(await seedBudget.pendingAgentCommission(agent1.address)).to.equal(commission);
    });

    it("reverts allocate commission exceeding KPI pool balance", async () => {
      // No distribution yet — pool is empty
      await expect(
        seedBudget.connect(admin).allocateAgentCommission(agent1.address, USDT_6(100))
      ).to.be.revertedWith("SeedBudget: exceeds KPI pool");
    });

    it("agent can claim their accumulated commission", async () => {
      // Distribute revenue
      const distAmount = USDT_6(1000);
      await usdt.mint(caller.address, distAmount);
      await usdt.connect(caller).approve(await seedBudget.getAddress(), distAmount);
      await seedBudget.connect(caller).receiveAndDistribute(distAmount);

      const commission = USDT_6(50);
      await seedBudget.connect(admin).allocateAgentCommission(agent1.address, commission);

      const balBefore = await usdt.balanceOf(agent1.address);
      await expect(seedBudget.connect(agent1).claimAgentCommission())
        .to.emit(seedBudget, "AgentCommissionClaimed")
        .withArgs(agent1.address, commission);

      expect(await usdt.balanceOf(agent1.address)).to.equal(balBefore + commission);
      expect(await seedBudget.pendingAgentCommission(agent1.address)).to.equal(0n);
    });

    it("reverts agent claim if nothing pending", async () => {
      await expect(
        seedBudget.connect(agent1).claimAgentCommission()
      ).to.be.revertedWith("SeedBudget: nothing to claim");
    });

    it("tracks pending KPI pool after allocations", async () => {
      const distAmount = USDT_6(1000);
      await usdt.mint(caller.address, distAmount);
      await usdt.connect(caller).approve(await seedBudget.getAddress(), distAmount);
      await seedBudget.connect(caller).receiveAndDistribute(distAmount);

      // KPI pool = 20% of 1000 = $200
      const kpiPool = (distAmount * BPS_AGENT_KPI) / 10_000n;

      const commission = USDT_6(50);
      await seedBudget.connect(admin).allocateAgentCommission(agent1.address, commission);

      expect(await seedBudget.kpiPoolBalance()).to.equal(kpiPool - commission);
    });
  });

  // ─── Admin wallet update ────────────────────────────────────────────────────

  describe("setLeadershipWallet", () => {
    it("admin can update a leadership wallet", async () => {
      await expect(seedBudget.connect(admin).setLeadershipWallet(0, nonAdmin.address))
        .to.emit(seedBudget, "LeadershipWalletUpdated")
        .withArgs(0, nonAdmin.address);

      expect(await seedBudget.leadershipWallet(0)).to.equal(nonAdmin.address);
    });

    it("reverts if non-admin tries to update", async () => {
      await expect(
        seedBudget.connect(nonAdmin).setLeadershipWallet(0, nonAdmin.address)
      ).to.be.reverted;
    });

    it("reverts if new wallet is zero address", async () => {
      await expect(
        seedBudget.connect(admin).setLeadershipWallet(0, ethers.ZeroAddress)
      ).to.be.revertedWith("SeedBudget: zero wallet");
    });

    it("reverts if role index >= 7", async () => {
      await expect(
        seedBudget.connect(admin).setLeadershipWallet(7, nonAdmin.address)
      ).to.be.revertedWith("SeedBudget: invalid role");
    });
  });

  // ─── Destination wallet updates ─────────────────────────────────────────────

  describe("setDestinations", () => {
    it("admin can update liquidityPool", async () => {
      await expect(seedBudget.connect(admin).setLiquidityPool(nonAdmin.address))
        .to.emit(seedBudget, "LiquidityPoolUpdated")
        .withArgs(nonAdmin.address);
      expect(await seedBudget.liquidityPool()).to.equal(nonAdmin.address);
    });

    it("admin can update auditWallet", async () => {
      await expect(seedBudget.connect(admin).setAuditWallet(nonAdmin.address))
        .to.emit(seedBudget, "AuditWalletUpdated")
        .withArgs(nonAdmin.address);
      expect(await seedBudget.auditWallet()).to.equal(nonAdmin.address);
    });

    it("admin can update daoReserve", async () => {
      await expect(seedBudget.connect(admin).setDaoReserve(nonAdmin.address))
        .to.emit(seedBudget, "DaoReserveUpdated")
        .withArgs(nonAdmin.address);
      expect(await seedBudget.daoReserve()).to.equal(nonAdmin.address);
    });

    it("reverts setting zero address for liquidityPool", async () => {
      await expect(
        seedBudget.connect(admin).setLiquidityPool(ethers.ZeroAddress)
      ).to.be.revertedWith("SeedBudget: zero address");
    });
  });
});
