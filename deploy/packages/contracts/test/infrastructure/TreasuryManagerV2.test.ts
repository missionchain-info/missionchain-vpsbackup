import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * The point of V2 is that nothing can get stuck. V1 held 105,000,000 MIC it could never
 * move, so these tests are written around exits rather than around features: every
 * balance the contract can hold must have a way out, and every MIC that leaves must
 * carry a vesting schedule with it.
 */

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));
const DAO_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DAO_ROLE"));
const SCHEDULE_CREATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SCHEDULE_CREATOR"));

const e18 = (n: string | number) => ethers.parseEther(String(n));
const usdt6 = (n: string | number) => ethers.parseUnits(String(n), 6);

describe("TreasuryManagerV2", () => {
  let tm: any, usdt: any, mic: any, lock: any, cv: any;
  let admin: SignerWithAddress, distributor: SignerWithAddress, dao: SignerWithAddress;
  let church: SignerWithAddress, stranger: SignerWithAddress;

  beforeEach(async () => {
    [admin, distributor, dao, church, stranger] = await ethers.getSigners();

    usdt = await (await ethers.getContractFactory("MockUSDT")).deploy();
    mic = await (await ethers.getContractFactory("MICToken")).deploy(admin.address);
    lock = await (await ethers.getContractFactory("LockManager")).deploy();

    tm = await (await ethers.getContractFactory("TreasuryManagerV2")).deploy(
      await usdt.getAddress(), await mic.getAddress(), await lock.getAddress(), admin.address,
    );
    cv = await (await ethers.getContractFactory("ChurchesVault")).deploy(
      await mic.getAddress(), await lock.getAddress(), admin.address,
    );
    await tm.connect(admin).setChurchesVault(await cv.getAddress());

    await tm.connect(admin).grantRole(DISTRIBUTOR_ROLE, distributor.address);
    await tm.connect(admin).grantRole(DAO_ROLE, dao.address);
    await lock.connect(admin).grantRole(SCHEDULE_CREATOR_ROLE, await cv.getAddress());

    await usdt.mint(distributor.address, usdt6(10_000_000));
    await usdt.connect(distributor).approve(await tm.getAddress(), ethers.MaxUint256);
    await mic.connect(admin).approve(await tm.getAddress(), ethers.MaxUint256);
  });

  // ── The defect V2 exists to prevent ────────────────────────────────────

  describe("MIC has an exit — the V1 defect", () => {
    it("splits an arrival 10 / 90 and moves the Churches share out for real", async () => {
      await tm.connect(admin).receiveMIC(e18("1000"));
      // Not a ledger entry — the MIC is physically in the other contract.
      expect(await mic.balanceOf(await cv.getAddress())).to.equal(e18("100"));
      expect(await tm.micDaoAllocated()).to.equal(e18("900"));
      expect(await tm.micToChurches()).to.equal(e18("100"));
    });

    it("the DAO share has an exit", async () => {
      await tm.connect(admin).receiveMIC(e18("1000"));
      await tm.connect(dao).transferDaoMIC(church.address, e18("900"), "ops");
      expect(await tm.micDaoRemaining()).to.equal(0n);
      expect(await mic.balanceOf(church.address)).to.equal(e18("900"));
    });

    it("the DAO cannot spend the Churches share", async () => {
      await tm.connect(admin).receiveMIC(e18("1000"));
      await expect(tm.connect(dao).transferDaoMIC(church.address, e18("901"), "grab"))
        .to.be.revertedWith("TMv2: exceeds DAO ledger");
    });
  });

  // ── The earmark: 10% of the DAO's slice ────────────────────────────────

  describe("Churches earmark", () => {
    it("books a direct mint without anyone calling receiveMIC", async () => {
      // EmissionController mints straight to this address — no callback exists.
      await mic.connect(admin).transfer(await tm.getAddress(), e18("1000"));
      expect(await tm.micUnbooked()).to.equal(e18("1000"));

      await tm.syncMic();
      expect(await mic.balanceOf(await cv.getAddress())).to.equal(e18("100"));
      expect(await tm.micDaoAllocated()).to.equal(e18("900"));
      expect(await tm.micUnbooked()).to.equal(0n);
    });

    it("anyone may run the bookkeeping — the route and the destination are fixed", async () => {
      await mic.connect(admin).transfer(await tm.getAddress(), e18("500"));
      await tm.connect(stranger).syncMic();
      expect(await mic.balanceOf(await cv.getAddress())).to.equal(e18("50"));
    });

    it("holds the Churches share when no vault is set, then pays the backlog", async () => {
      const solo = await (await ethers.getContractFactory("TreasuryManagerV2")).deploy(
        await usdt.getAddress(), await mic.getAddress(), await lock.getAddress(), admin.address,
      );
      await mic.connect(admin).transfer(await solo.getAddress(), e18("1000"));
      await solo.syncMic();
      // Not lost, and not quietly handed to the DAO.
      expect(await solo.churchesPending()).to.equal(e18("100"));
      expect(await solo.micDaoAllocated()).to.equal(e18("900"));

      await solo.connect(admin).setChurchesVault(await cv.getAddress());
      expect(await solo.churchesPending()).to.equal(0n);
      expect(await mic.balanceOf(await cv.getAddress())).to.equal(e18("100"));
    });

    it("gives rounding dust to the DAO so nothing stays unclassified", async () => {
      await mic.connect(admin).transfer(await tm.getAddress(), 7n);
      await tm.syncMic();
      expect(await tm.micUnbooked()).to.equal(0n);
      expect(await tm.micDaoAllocated()).to.equal(7n);   // 10% of 7 rounds to 0
    });

    it("accumulates across many daily emissions", async () => {
      for (let i = 0; i < 5; i++) {
        await mic.connect(admin).transfer(await tm.getAddress(), e18("1000"));
        await tm.syncMic();
      }
      expect(await mic.balanceOf(await cv.getAddress())).to.equal(e18("500"));
      expect(await tm.micDaoAllocated()).to.equal(e18("4500"));
    });
  });

  // ── Vesting is enforced, not promised ──────────────────────────────────

  describe("Vesting happens in the vault", () => {
    beforeEach(async () => { await tm.connect(admin).receiveMIC(e18("10000000")); });  // 1M to Churches

    it("a grant leaves the vault and is fully locked at the recipient", async () => {
      await cv.connect(admin).grant(church.address, e18("1000000"), "Church partner");
      expect(await mic.balanceOf(church.address)).to.equal(e18("1000000"));
      expect(await lock.lockedOf(church.address)).to.equal(e18("1000000"));
      expect(await cv.available()).to.equal(0n);
    });

    it("uses the published schedule: 24-month cliff, 10%, then 2.5% monthly", async () => {
      expect(await cv.CLIFF_DURATION()).to.equal(730n * 24n * 60n * 60n);
      expect(await cv.CLIFF_UNLOCK_BPS()).to.equal(1000n);
      expect(await cv.MONTHLY_BPS()).to.equal(250n);
    });

    it("there is no unvested path out of the vault", async () => {
      const abi = cv.interface.fragments
        .filter((f: any) => f.type === "function" && f.stateMutability !== "view" && f.stateMutability !== "pure")
        .map((f: any) => f.name);
      expect(abi).to.include("grant");
      expect(abi).to.not.include("withdraw");
      expect(abi).to.not.include("transfer");
      // rescueToken exists but refuses MIC outright:
      await expect(cv.connect(admin).rescueToken(await mic.getAddress(), admin.address, 1n))
        .to.be.revertedWith("CV: use grant() for MIC");
    });

    it("records every grant on-chain", async () => {
      await cv.connect(admin).grant(church.address, e18("100"), "Hub Lagos");
      await cv.connect(admin).grant(church.address, e18("250"), "Hub Manila");
      expect(await cv.grantCount()).to.equal(2n);
      expect(await cv.grantedTo(church.address)).to.equal(e18("350"));
      const g = await cv.getGrant(1);
      expect(g.purpose).to.equal("Hub Manila");
      expect(g.amount).to.equal(e18("250"));
    });

    it("cannot grant more than the vault holds", async () => {
      await expect(cv.connect(admin).grant(church.address, e18("1000001"), "too much"))
        .to.be.revertedWith("CV: insufficient balance");
    });

    it("only a grantor may issue grants", async () => {
      await expect(cv.connect(stranger).grant(stranger.address, e18("1"), "x")).to.be.reverted;
    });
  });

  // ── USDT keeps V1's guardrails ─────────────────────────────────────────

  describe("USDT sub-pools", () => {
    it("splits an inbound transfer 20 / 40 / 40 and gives dust to Reserved", async () => {
      await tm.connect(distributor).receiveUSDT(usdt6(1000));
      expect(await tm.subPoolBalance(0)).to.equal(usdt6(200));
      expect(await tm.subPoolBalance(1)).to.equal(usdt6(400));
      expect(await tm.subPoolBalance(2)).to.equal(usdt6(400));

      // 3 wei cannot divide evenly; nothing may be lost.
      await tm.connect(distributor).receiveUSDT(3n);
      const total = (await tm.subPoolBalance(0)) + (await tm.subPoolBalance(1)) + (await tm.subPoolBalance(2));
      expect(total).to.equal(usdt6(1000) + 3n);
    });

    it("caps a single transfer at 5% of the sub-pool", async () => {
      await tm.connect(distributor).receiveUSDT(usdt6(10_000));   // World Dev = 2,000
      await expect(tm.connect(admin).transferUsdt(0, church.address, usdt6(101)))
        .to.be.revertedWith("TMv2: exceeds 5% limit");
      await tm.connect(admin).transferUsdt(0, church.address, usdt6(100));
      expect(await usdt.balanceOf(church.address)).to.equal(usdt6(100));
    });

    it("allows two transfers per 30-day period and refuses the third", async () => {
      await tm.connect(distributor).receiveUSDT(usdt6(10_000));
      await tm.connect(admin).transferUsdt(0, church.address, usdt6(50));
      await tm.connect(admin).transferUsdt(0, church.address, usdt6(50));
      await expect(tm.connect(admin).transferUsdt(0, church.address, usdt6(10)))
        .to.be.revertedWith("TMv2: monthly limit reached");
    });

    it("lets the DAO bypass the rate limit in an emergency", async () => {
      await tm.connect(distributor).receiveUSDT(usdt6(10_000));
      await tm.connect(dao).emergencyWithdrawUsdt(0, church.address, usdt6(2000));
      expect(await tm.subPoolBalance(0)).to.equal(0n);
    });

    it("only the DAO may do so", async () => {
      await tm.connect(distributor).receiveUSDT(usdt6(10_000));
      await expect(tm.connect(admin).emergencyWithdrawUsdt(0, church.address, usdt6(1))).to.be.reverted;
    });
  });

  // ── Rescue — the safety net V1 lacked ──────────────────────────────────

  describe("Rescue", () => {
    it("recovers a token nobody planned for", async () => {
      const stray = await (await ethers.getContractFactory("MockUSDT")).deploy();
      await stray.mint(await tm.getAddress(), usdt6(500));
      await tm.connect(dao).rescueToken(await stray.getAddress(), church.address, usdt6(500));
      expect(await stray.balanceOf(church.address)).to.equal(usdt6(500));
    });

    it("cannot sweep MIC — arriving MIC is emission, not a stray deposit", async () => {
      await mic.connect(admin).transfer(await tm.getAddress(), e18("777"));
      await expect(tm.connect(dao).rescueToken(await mic.getAddress(), stranger.address, e18("1")))
        .to.be.revertedWith("TMv2: would touch accounted balance");
      // The booking inside the reverted call rolled back with it, so run it separately.
      await tm.syncMic();
      expect(await tm.micDaoRemaining()).to.equal(e18("699.3"));
      expect(await mic.balanceOf(await cv.getAddress())).to.equal(e18("77.7"));
    });

    it("cannot touch MIC that is booked for the DAO", async () => {
      await tm.connect(admin).receiveMIC(e18("1000"));
      await expect(tm.connect(dao).rescueToken(await mic.getAddress(), stranger.address, e18("1")))
        .to.be.revertedWith("TMv2: would touch accounted balance");
    });

    it("cannot touch USDT backing the sub-pools", async () => {
      await tm.connect(distributor).receiveUSDT(usdt6(1000));
      await expect(tm.connect(dao).rescueToken(await usdt.getAddress(), stranger.address, usdt6(1)))
        .to.be.revertedWith("TMv2: would touch accounted balance");
    });

    it("reaches only the surplus of a foreign token, never the accounted ones", async () => {
      const stray = await (await ethers.getContractFactory("MockUSDT")).deploy();
      await stray.mint(await tm.getAddress(), usdt6(90));
      await tm.connect(dao).rescueToken(await stray.getAddress(), church.address, usdt6(90));
      expect(await stray.balanceOf(church.address)).to.equal(usdt6(90));
    });

    it("is DAO-gated", async () => {
      await expect(tm.connect(stranger).rescueToken(await mic.getAddress(), stranger.address, 1n)).to.be.reverted;
    });
  });

  // ── Access control ─────────────────────────────────────────────────────

  describe("Access control", () => {
    it("only the distributor may push USDT in", async () => {
      await usdt.mint(stranger.address, usdt6(100));
      await usdt.connect(stranger).approve(await tm.getAddress(), ethers.MaxUint256);
      await expect(tm.connect(stranger).receiveUSDT(usdt6(100))).to.be.reverted;
    });

    it("only DAO_ROLE may spend the DAO share", async () => {
      await tm.connect(admin).receiveMIC(e18("100"));
      await expect(tm.connect(stranger).transferDaoMIC(stranger.address, e18("10"), "x")).to.be.reverted;
    });

    it("anyone may book MIC in — funding the treasury is never gated", async () => {
      await mic.connect(admin).transfer(stranger.address, e18("10"));
      await mic.connect(stranger).approve(await tm.getAddress(), ethers.MaxUint256);
      await tm.connect(stranger).receiveMIC(e18("10"));
      expect(await mic.balanceOf(await cv.getAddress())).to.equal(e18("1"));
      expect(await tm.micDaoAllocated()).to.equal(e18("9"));
    });
  });
});
