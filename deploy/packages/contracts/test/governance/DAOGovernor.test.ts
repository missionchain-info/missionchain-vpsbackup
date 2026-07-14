import { expect } from "chai";
import { ethers, network } from "hardhat";
import { DAOGovernor } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("DAOGovernor", function () {
  let dao: DAOGovernor;
  let owner: SignerWithAddress;
  let btc0: SignerWithAddress; // Ban Thuong Truc members
  let btc1: SignerWithAddress;
  let btc2: SignerWithAddress;
  let btc3: SignerWithAddress;
  let btc4: SignerWithAddress;
  let stranger: SignerWithAddress;
  let target: SignerWithAddress;

  // Timelock categories enum indices
  const CAT_PARAMETER  = 0;
  const CAT_BUDGET     = 1;
  const CAT_STRUCTURAL = 2;
  const CAT_EMERGENCY  = 3;

  const BTC_MEMBER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BTC_MEMBER"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  // Helper: advance time
  async function increaseTime(seconds: number) {
    await network.provider.send("evm_increaseTime", [seconds]);
    await network.provider.send("evm_mine", []);
  }

  beforeEach(async () => {
    [owner, btc0, btc1, btc2, btc3, btc4, stranger, target] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("DAOGovernor");
    dao = await Factory.deploy(owner.address);
  });

  // ─────────────────────────────────────────────────────────
  // Constructor
  // ─────────────────────────────────────────────────────────
  describe("Constructor", () => {
    it("should set originalOwner to deployer", async () => {
      expect(await dao.originalOwner()).to.equal(owner.address);
    });

    it("should grant DEFAULT_ADMIN_ROLE to deployer", async () => {
      expect(await dao.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("should start in Phase 1 (daoActive = false)", async () => {
      expect(await dao.daoActive()).to.be.false;
    });

    it("should start with proposalCount = 0", async () => {
      expect(await dao.proposalCount()).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Phase 1: Owner controls
  // ─────────────────────────────────────────────────────────
  describe("Phase 1 — Owner controls", () => {
    it("should allow owner to set temporary BTC members", async () => {
      const members: [string, string, string, string, string] = [
        btc0.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await dao.connect(owner).setTemporaryMembers(members);
      for (const m of members) {
        expect(await dao.hasRole(BTC_MEMBER_ROLE, m)).to.be.true;
      }
    });

    it("should store BTC member addresses in btcMembers array", async () => {
      const members: [string, string, string, string, string] = [
        btc0.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await dao.connect(owner).setTemporaryMembers(members);
      for (let i = 0; i < 5; i++) {
        expect(await dao.btcMembers(i)).to.equal(members[i]);
      }
    });

    it("should revoke old BTC roles when setting new members", async () => {
      const first: [string, string, string, string, string] = [
        btc0.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await dao.connect(owner).setTemporaryMembers(first);

      const second: [string, string, string, string, string] = [
        stranger.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await dao.connect(owner).setTemporaryMembers(second);

      // btc0 was removed
      expect(await dao.hasRole(BTC_MEMBER_ROLE, btc0.address)).to.be.false;
      // stranger was added
      expect(await dao.hasRole(BTC_MEMBER_ROLE, stranger.address)).to.be.true;
    });

    it("should revert when non-owner tries to set members", async () => {
      const members: [string, string, string, string, string] = [
        btc0.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await expect(
        dao.connect(stranger).setTemporaryMembers(members)
      ).to.be.reverted;
    });

    it("should revert setTemporaryMembers if daoActive", async () => {
      const members: [string, string, string, string, string] = [
        btc0.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await dao.connect(owner).renounceOwnershipToDAO();
      await expect(
        dao.connect(owner).setTemporaryMembers(members)
      ).to.be.revertedWith("DAO: already active");
    });
  });

  // ─────────────────────────────────────────────────────────
  // renounceOwnershipToDAO — one-time irreversible
  // ─────────────────────────────────────────────────────────
  describe("renounceOwnershipToDAO", () => {
    it("should set daoActive to true", async () => {
      await dao.connect(owner).renounceOwnershipToDAO();
      expect(await dao.daoActive()).to.be.true;
    });

    it("should revoke DEFAULT_ADMIN_ROLE from original owner", async () => {
      await dao.connect(owner).renounceOwnershipToDAO();
      expect(await dao.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.false;
    });

    it("should grant DEFAULT_ADMIN_ROLE to DAOGovernor contract itself", async () => {
      await dao.connect(owner).renounceOwnershipToDAO();
      expect(await dao.hasRole(DEFAULT_ADMIN_ROLE, await dao.getAddress())).to.be.true;
    });

    it("should emit OwnershipRenounced event", async () => {
      await expect(dao.connect(owner).renounceOwnershipToDAO())
        .to.emit(dao, "OwnershipRenounced")
        .withArgs(owner.address);
    });

    it("should revert if called by non-owner", async () => {
      await expect(dao.connect(stranger).renounceOwnershipToDAO()).to.be.reverted;
    });

    it("should revert if called twice", async () => {
      await dao.connect(owner).renounceOwnershipToDAO();
      await expect(
        dao.connect(owner).renounceOwnershipToDAO()
      ).to.be.revertedWith("DAO: already active");
    });
  });

  // ─────────────────────────────────────────────────────────
  // Proposals — propose
  // ─────────────────────────────────────────────────────────
  describe("Proposals — propose()", () => {
    beforeEach(async () => {
      const members: [string, string, string, string, string] = [
        btc0.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await dao.connect(owner).setTemporaryMembers(members);
    });

    it("should allow BTC member to create a proposal", async () => {
      const callData = "0xdeadbeef";
      const tx = await dao
        .connect(btc0)
        .propose(target.address, callData, CAT_PARAMETER);
      const receipt = await tx.wait();
      expect(receipt?.status).to.equal(1);
      expect(await dao.proposalCount()).to.equal(1n);
    });

    it("should emit ProposalCreated event", async () => {
      const callData = "0x1234";
      await expect(
        dao.connect(btc0).propose(target.address, callData, CAT_PARAMETER)
      )
        .to.emit(dao, "ProposalCreated")
        .withArgs(1n, btc0.address, target.address, CAT_PARAMETER);
    });

    it("should revert when non-BTC member tries to propose", async () => {
      await expect(
        dao.connect(stranger).propose(target.address, "0x", CAT_PARAMETER)
      ).to.be.revertedWith("DAO: not BTC member");
    });

    it("should auto-approve for proposer (counts as 1 approval)", async () => {
      await dao.connect(btc0).propose(target.address, "0x", CAT_PARAMETER);
      const [, , , , , approvalCount, ,] = await dao.getProposal(1n);
      expect(approvalCount).to.equal(1n);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Proposals — approve
  // ─────────────────────────────────────────────────────────
  describe("Proposals — approve()", () => {
    beforeEach(async () => {
      const members: [string, string, string, string, string] = [
        btc0.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await dao.connect(owner).setTemporaryMembers(members);
      // btc0 proposes (gets 1 auto-approval)
      await dao.connect(btc0).propose(target.address, "0x", CAT_PARAMETER);
    });

    it("should allow another BTC member to approve", async () => {
      await dao.connect(btc1).approve(1n);
      const [, , , , , approvalCount, ,] = await dao.getProposal(1n);
      expect(approvalCount).to.equal(2n);
    });

    it("should revert if non-BTC member tries to approve", async () => {
      await expect(dao.connect(stranger).approve(1n)).to.be.revertedWith(
        "DAO: not BTC member"
      );
    });

    it("should revert if same member approves twice", async () => {
      await expect(dao.connect(btc0).approve(1n)).to.be.revertedWith(
        "DAO: already approved"
      );
    });

    it("should mark proposal APPROVED after 3/5 approvals", async () => {
      await dao.connect(btc1).approve(1n);
      await dao.connect(btc2).approve(1n);
      // now 3/5
      const [, , , , , , state,] = await dao.getProposal(1n);
      expect(state).to.equal(1n); // ProposalState.APPROVED = 1
    });

    it("should emit ProposalApproved event", async () => {
      await expect(dao.connect(btc1).approve(1n))
        .to.emit(dao, "ProposalApproved")
        .withArgs(1n, btc1.address, 2n);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Proposals — execute with timelock
  // ─────────────────────────────────────────────────────────
  describe("Proposals — execute() with timelock", () => {
    let MockCallTarget: any;
    let mockTarget: any;

    beforeEach(async () => {
      const members: [string, string, string, string, string] = [
        btc0.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await dao.connect(owner).setTemporaryMembers(members);
      MockCallTarget = await ethers.getContractFactory("MockCallTarget");
      mockTarget = await MockCallTarget.deploy();
    });

    it("should revert execution before timelock expires (PARAMETER)", async () => {
      const callData = mockTarget.interface.encodeFunctionData("doSomething");
      await dao
        .connect(btc0)
        .propose(await mockTarget.getAddress(), callData, CAT_PARAMETER);
      await dao.connect(btc1).approve(1n);
      await dao.connect(btc2).approve(1n);
      // 24h timelock — not enough time passed
      await increaseTime(3600); // only 1 hour
      await expect(dao.execute(1n)).to.be.revertedWith("DAO: timelock not expired");
    });

    it("should execute after 24h timelock for PARAMETER proposals", async () => {
      const callData = mockTarget.interface.encodeFunctionData("doSomething");
      await dao
        .connect(btc0)
        .propose(await mockTarget.getAddress(), callData, CAT_PARAMETER);
      await dao.connect(btc1).approve(1n);
      await dao.connect(btc2).approve(1n);
      await increaseTime(24 * 3600 + 1);
      await expect(dao.execute(1n)).to.emit(dao, "ProposalExecuted").withArgs(1n);
    });

    it("should execute after 24h timelock for BUDGET proposals", async () => {
      const callData = mockTarget.interface.encodeFunctionData("doSomething");
      await dao
        .connect(btc0)
        .propose(await mockTarget.getAddress(), callData, CAT_BUDGET);
      await dao.connect(btc1).approve(1n);
      await dao.connect(btc2).approve(1n);
      await increaseTime(24 * 3600 + 1);
      await expect(dao.execute(1n)).to.emit(dao, "ProposalExecuted");
    });

    it("should require 7 days for STRUCTURAL proposals", async () => {
      const callData = mockTarget.interface.encodeFunctionData("doSomething");
      await dao
        .connect(btc0)
        .propose(await mockTarget.getAddress(), callData, CAT_STRUCTURAL);
      await dao.connect(btc1).approve(1n);
      await dao.connect(btc2).approve(1n);
      // Only 24h — should fail
      await increaseTime(24 * 3600 + 1);
      await expect(dao.execute(1n)).to.be.revertedWith("DAO: timelock not expired");
      // 7 days — should succeed
      await increaseTime(6 * 24 * 3600);
      await expect(dao.execute(1n)).to.emit(dao, "ProposalExecuted");
    });

    it("should revert if proposal not yet approved (< 3/5)", async () => {
      const callData = mockTarget.interface.encodeFunctionData("doSomething");
      await dao
        .connect(btc0)
        .propose(await mockTarget.getAddress(), callData, CAT_PARAMETER);
      await dao.connect(btc1).approve(1n); // only 2/5
      await increaseTime(24 * 3600 + 1);
      await expect(dao.execute(1n)).to.be.revertedWith("DAO: not approved");
    });

    it("should revert re-execution of already executed proposal", async () => {
      const callData = mockTarget.interface.encodeFunctionData("doSomething");
      await dao
        .connect(btc0)
        .propose(await mockTarget.getAddress(), callData, CAT_PARAMETER);
      await dao.connect(btc1).approve(1n);
      await dao.connect(btc2).approve(1n);
      await increaseTime(24 * 3600 + 1);
      await dao.execute(1n);
      await expect(dao.execute(1n)).to.be.revertedWith("DAO: not approved");
    });

    it("should allow anyone (not just BTC) to call execute", async () => {
      const callData = mockTarget.interface.encodeFunctionData("doSomething");
      await dao
        .connect(btc0)
        .propose(await mockTarget.getAddress(), callData, CAT_PARAMETER);
      await dao.connect(btc1).approve(1n);
      await dao.connect(btc2).approve(1n);
      await increaseTime(24 * 3600 + 1);
      // stranger calls execute
      await expect(dao.connect(stranger).execute(1n)).to.emit(
        dao,
        "ProposalExecuted"
      );
    });
  });

  // ─────────────────────────────────────────────────────────
  // Emergency pause — instant (0 timelock)
  // ─────────────────────────────────────────────────────────
  describe("Emergency — emergencyPause()", () => {
    let mockPausable: any;

    beforeEach(async () => {
      const members: [string, string, string, string, string] = [
        btc0.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await dao.connect(owner).setTemporaryMembers(members);
      const MockPausable = await ethers.getContractFactory("MockPausableTarget");
      mockPausable = await MockPausable.deploy();
    });

    it("should revert if fewer than 3 BTC members sign", async () => {
      const signers = [btc0, btc1]; // only 2
      const targetAddr = await mockPausable.getAddress();
      await expect(
        dao.connect(btc0).emergencyPause(targetAddr, [btc0.address, btc1.address])
      ).to.be.revertedWith("DAO: insufficient BTC signatures");
    });

    it("should execute emergency pause instantly with 3 BTC members", async () => {
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

    it("should revert if a signer address is not a BTC member", async () => {
      const targetAddr = await mockPausable.getAddress();
      await expect(
        dao.connect(btc0).emergencyPause(targetAddr, [
          btc0.address,
          btc1.address,
          stranger.address, // not a BTC member
        ])
      ).to.be.revertedWith("DAO: signer not BTC member");
    });

    it("should revert duplicate signers", async () => {
      const targetAddr = await mockPausable.getAddress();
      await expect(
        dao.connect(btc0).emergencyPause(targetAddr, [
          btc0.address,
          btc0.address, // duplicate
          btc1.address,
        ])
      ).to.be.revertedWith("DAO: duplicate signer");
    });
  });

  // ─────────────────────────────────────────────────────────
  // Timelock constants
  // ─────────────────────────────────────────────────────────
  describe("Timelock constants", () => {
    it("should have 24h for PARAMETER", async () => {
      expect(await dao.TIMELOCK_PARAMETER()).to.equal(24n * 3600n);
    });

    it("should have 24h for BUDGET", async () => {
      expect(await dao.TIMELOCK_BUDGET()).to.equal(24n * 3600n);
    });

    it("should have 7 days for STRUCTURAL", async () => {
      expect(await dao.TIMELOCK_STRUCTURAL()).to.equal(7n * 24n * 3600n);
    });

    it("should have 0 for EMERGENCY", async () => {
      expect(await dao.TIMELOCK_EMERGENCY()).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Phase 2 enforcement: setTemporaryMembers reverts
  // ─────────────────────────────────────────────────────────
  describe("Phase transition guard", () => {
    it("should prevent setTemporaryMembers after DAO is active", async () => {
      await dao.connect(owner).renounceOwnershipToDAO();
      const members: [string, string, string, string, string] = [
        btc0.address, btc1.address, btc2.address, btc3.address, btc4.address,
      ];
      await expect(
        dao.connect(owner).setTemporaryMembers(members)
      ).to.be.revertedWith("DAO: already active");
    });
  });
});
