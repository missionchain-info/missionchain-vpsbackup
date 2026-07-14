import { expect } from "chai";
import { ethers, network } from "hardhat";
import { DAOGovernor, MICToken } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Integration Test: Owner → DAO Governance Transition
 *
 * Tests the complete lifecycle:
 *   Phase 1 (Owner): Deploy, set BTC members, owner controls MICToken
 *   Transition:      renounceOwnershipToDAO() — irreversible
 *   Phase 2 (DAO):   Owner loses control, DAO governs via proposals
 *   Emergency:       BTC 3/5 instant pause, no timelock
 */
describe("Integration: Owner → DAO Governance Transition", function () {
  // ─── Signers ───────────────────────────────────────────────────────────────
  let owner: SignerWithAddress;
  let btc0: SignerWithAddress;
  let btc1: SignerWithAddress;
  let btc2: SignerWithAddress;
  let btc3: SignerWithAddress;
  let btc4: SignerWithAddress;
  let stranger: SignerWithAddress;

  // ─── Contracts ─────────────────────────────────────────────────────────────
  let dao: DAOGovernor;
  let micToken: MICToken;
  let mockTarget: any;
  let mockPausable: any;

  // ─── Constants ─────────────────────────────────────────────────────────────
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  const CAT_PARAMETER = 0;   // TimelockCategory.PARAMETER
  const CAT_EMERGENCY = 3;   // TimelockCategory.EMERGENCY
  const TIMELOCK_24H = 24 * 3600;

  // ─── Helper ────────────────────────────────────────────────────────────────
  async function increaseTime(seconds: number) {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine", []);
  }

  // ─── Setup ─────────────────────────────────────────────────────────────────
  before(async () => {
    [owner, btc0, btc1, btc2, btc3, btc4, stranger] = await ethers.getSigners();

    // Deploy DAOGovernor with owner as admin
    const DAOFactory = await ethers.getContractFactory("DAOGovernor");
    dao = await DAOFactory.deploy(owner.address);

    // Deploy MICToken with owner as treasury (gets DEFAULT_ADMIN_ROLE)
    const MICFactory = await ethers.getContractFactory("MICToken");
    micToken = await MICFactory.deploy(owner.address);

    // Deploy mock contracts for proposal execution
    const MockCallTargetFactory = await ethers.getContractFactory("MockCallTarget");
    mockTarget = await MockCallTargetFactory.deploy();

    const MockPausableFactory = await ethers.getContractFactory("MockPausableTarget");
    mockPausable = await MockPausableFactory.deploy();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Owner controls
  // ══════════════════════════════════════════════════════════════════════════
  describe("Phase 1 — Owner controls", () => {
    it("DAOGovernor starts in Phase 1 (daoActive = false)", async () => {
      expect(await dao.daoActive()).to.be.false;
    });

    it("owner holds DEFAULT_ADMIN_ROLE on DAOGovernor", async () => {
      expect(await dao.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("owner can set 5 temporary BTC members", async () => {
      const members: [string, string, string, string, string] = [
        btc0.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await dao.connect(owner).setTemporaryMembers(members);

      const BTC_MEMBER_ROLE = await dao.BTC_MEMBER_ROLE();
      for (const m of members) {
        expect(await dao.hasRole(BTC_MEMBER_ROLE, m)).to.be.true;
      }
    });

    it("owner can call setApprovedStakingContract on MICToken (owner has DEFAULT_ADMIN_ROLE)", async () => {
      // owner has DEFAULT_ADMIN_ROLE on MICToken — can call admin functions
      await expect(
        micToken.connect(owner).setApprovedStakingContract(stranger.address, true)
      ).to.not.be.reverted;
      expect(await micToken.approvedStakingContracts(stranger.address)).to.be.true;

      // Clean up
      await micToken.connect(owner).setApprovedStakingContract(stranger.address, false);
    });

    it("BTC members cannot call setApprovedStakingContract on MICToken (no admin role)", async () => {
      // BTC members are not granted DEFAULT_ADMIN_ROLE on MICToken
      await expect(
        micToken.connect(btc0).setApprovedStakingContract(stranger.address, true)
      ).to.be.reverted;
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // TRANSITION: renounceOwnershipToDAO()
  // ══════════════════════════════════════════════════════════════════════════
  describe("Transition — renounceOwnershipToDAO()", () => {
    it("owner calls renounceOwnershipToDAO() — emits OwnershipRenounced", async () => {
      await expect(dao.connect(owner).renounceOwnershipToDAO())
        .to.emit(dao, "OwnershipRenounced")
        .withArgs(owner.address);
    });

    it("daoActive is now true", async () => {
      expect(await dao.daoActive()).to.be.true;
    });

    it("owner no longer has DEFAULT_ADMIN_ROLE on DAOGovernor", async () => {
      expect(await dao.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.false;
    });

    it("DAOGovernor contract itself holds DEFAULT_ADMIN_ROLE", async () => {
      const daoAddress = await dao.getAddress();
      expect(await dao.hasRole(DEFAULT_ADMIN_ROLE, daoAddress)).to.be.true;
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2: DAO governs — owner loses control
  // ══════════════════════════════════════════════════════════════════════════
  describe("Phase 2 — DAO governs, owner locked out", () => {
    it("owner cannot call setTemporaryMembers anymore (reverts: DAO already active)", async () => {
      const members: [string, string, string, string, string] = [
        btc0.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await expect(
        dao.connect(owner).setTemporaryMembers(members)
      ).to.be.revertedWith("DAO: already active");
    });

    it("owner loses DEFAULT_ADMIN_ROLE on MICToken — cannot call setApprovedStakingContract via DAO phase test", async () => {
      // Grant DEFAULT_ADMIN_ROLE on MICToken to DAOGovernor so DAO can govern token
      // First, owner still has admin on MICToken (MICToken was not affected by DAO transition)
      const daoAddress = await dao.getAddress();
      await micToken.connect(owner).grantRole(DEFAULT_ADMIN_ROLE, daoAddress);

      // Now revoke owner's admin on MICToken to simulate full transition
      await micToken.connect(owner).revokeRole(DEFAULT_ADMIN_ROLE, owner.address);

      // Owner can no longer call admin functions on MICToken
      await expect(
        micToken.connect(owner).setApprovedStakingContract(stranger.address, true)
      ).to.be.reverted;
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2: DAO governance proposal flow
  // ══════════════════════════════════════════════════════════════════════════
  describe("Phase 2 — DAO proposal: setValue(42) on MockCallTarget", () => {
    let proposalId: bigint;

    it("BTC member (btc0) proposes action: MockCallTarget.setValue(42)", async () => {
      const callData = mockTarget.interface.encodeFunctionData("setValue", [42]);
      const tx = await dao
        .connect(btc0)
        .propose(await mockTarget.getAddress(), callData, CAT_PARAMETER);
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);

      proposalId = await dao.proposalCount();
      expect(proposalId).to.be.gt(0n);
    });

    it("auto-approval: proposer (btc0) counts as 1 approval", async () => {
      const [, , , , , approvalCount, state] = await dao.getProposal(proposalId);
      expect(approvalCount).to.equal(1n);
      expect(state).to.equal(0n); // PENDING — need 3 total
    });

    it("btc1 approves → 2 approvals, still PENDING", async () => {
      await dao.connect(btc1).approve(proposalId);
      const [, , , , , approvalCount, state] = await dao.getProposal(proposalId);
      expect(approvalCount).to.equal(2n);
      expect(state).to.equal(0n); // PENDING
    });

    it("btc2 approves → 3 approvals, proposal becomes APPROVED", async () => {
      await dao.connect(btc2).approve(proposalId);
      const [, , , , , approvalCount, state] = await dao.getProposal(proposalId);
      expect(approvalCount).to.equal(3n);
      expect(state).to.equal(1n); // APPROVED
    });

    it("execution fails before 24h timelock expires", async () => {
      await increaseTime(3600); // only 1 hour
      await expect(dao.execute(proposalId)).to.be.revertedWith("DAO: timelock not expired");
    });

    it("anyone (stranger) can execute after 24h timelock", async () => {
      await increaseTime(TIMELOCK_24H); // advance past timelock
      await expect(dao.connect(stranger).execute(proposalId))
        .to.emit(dao, "ProposalExecuted")
        .withArgs(proposalId);
    });

    it("MockCallTarget.value() is now 42", async () => {
      expect(await mockTarget.value()).to.equal(42n);
    });

    it("re-execution of executed proposal reverts", async () => {
      await expect(dao.execute(proposalId)).to.be.revertedWith("DAO: not approved");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2: DAO controlling MICToken via proposal
  // ══════════════════════════════════════════════════════════════════════════
  describe("Phase 2 — DAO can govern MICToken via proposals", () => {
    let micProposalId: bigint;

    it("BTC member proposes: MICToken.setApprovedStakingContract(stranger, true)", async () => {
      const callData = micToken.interface.encodeFunctionData(
        "setApprovedStakingContract",
        [stranger.address, true]
      );
      const tx = await dao
        .connect(btc0)
        .propose(await micToken.getAddress(), callData, CAT_PARAMETER);
      await tx.wait();
      micProposalId = await dao.proposalCount();
    });

    it("3/5 BTC members approve the MICToken proposal", async () => {
      await dao.connect(btc1).approve(micProposalId);
      await dao.connect(btc2).approve(micProposalId);
      const [, , , , , approvalCount, state] = await dao.getProposal(micProposalId);
      expect(approvalCount).to.equal(3n);
      expect(state).to.equal(1n); // APPROVED
    });

    it("executes after 24h timelock — MICToken recognizes DAOGovernor as caller", async () => {
      await increaseTime(TIMELOCK_24H + 1);
      await expect(dao.execute(micProposalId))
        .to.emit(dao, "ProposalExecuted")
        .withArgs(micProposalId);
    });

    it("MICToken.approvedStakingContracts(stranger) is now true", async () => {
      expect(await micToken.approvedStakingContracts(stranger.address)).to.be.true;
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EMERGENCY: instant pause via emergencyPause (0 timelock)
  // ══════════════════════════════════════════════════════════════════════════
  describe("Emergency — instant pause with 3/5 BTC signatures", () => {
    it("BTC member creates emergency pause on MockPausableTarget (3 signers)", async () => {
      const targetAddr = await mockPausable.getAddress();
      await expect(
        dao.connect(btc0).emergencyPause(targetAddr, [
          btc0.address,
          btc1.address,
          btc2.address,
        ])
      )
        .to.emit(dao, "EmergencyPauseExecuted")
        .withArgs(targetAddr, btc0.address);
    });

    it("MockPausableTarget is now paused", async () => {
      expect(await mockPausable.paused()).to.be.true;
    });

    it("emergency pause with only 2 signers reverts (insufficient)", async () => {
      const targetAddr = await mockPausable.getAddress();
      await expect(
        dao.connect(btc0).emergencyPause(targetAddr, [btc0.address, btc1.address])
      ).to.be.revertedWith("DAO: insufficient BTC signatures");
    });

    it("emergency pause with non-BTC signer reverts", async () => {
      const targetAddr = await mockPausable.getAddress();
      await expect(
        dao.connect(btc0).emergencyPause(targetAddr, [
          btc0.address,
          btc1.address,
          stranger.address,
        ])
      ).to.be.revertedWith("DAO: signer not BTC member");
    });

    it("emergency pause with duplicate signer reverts", async () => {
      const targetAddr = await mockPausable.getAddress();
      await expect(
        dao.connect(btc0).emergencyPause(targetAddr, [
          btc0.address,
          btc0.address,
          btc1.address,
        ])
      ).to.be.revertedWith("DAO: duplicate signer");
    });

    it("non-BTC member cannot call emergencyPause", async () => {
      const targetAddr = await mockPausable.getAddress();
      await expect(
        dao.connect(stranger).emergencyPause(targetAddr, [
          btc0.address,
          btc1.address,
          btc2.address,
        ])
      ).to.be.revertedWith("DAO: not BTC member");
    });
  });
});
