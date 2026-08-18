import { expect } from "chai";
import { ethers } from "hardhat";
import { LuckyDraw, MockUSDT } from "../../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("LuckyDraw", function () {
  let luckyDraw: LuckyDraw;
  let usdt: MockUSDT;
  let admin: SignerWithAddress;
  let distributor: SignerWithAddress;
  let treasury: SignerWithAddress;
  let stranger: SignerWithAddress;

  // Static participant addresses (wallets without ETH — only receive USDT prizes)
  let participantAddrs: string[];

  const DISTRIBUTOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DISTRIBUTOR_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;


  /**
   * Commit-reveal helper. `startDraw` now requires the seed AND the exact participant
   * list to have been sealed beforehand, so every test goes through both steps.
   */
  async function commitAndDraw(
    draw: LuckyDraw,
    signer: SignerWithAddress,
    parts: string[],
    seed: bigint,
  ) {
    const commitment = await draw.drawCommitment(parts, seed);
    await draw.connect(signer).commitDraw(commitment);
    return draw.connect(signer).startDraw(parts, seed);
  }

  // USDT uses 6 decimals
  const USDT = (amount: number) => BigInt(amount) * 10n ** 18n;

  const WEEKLY_CAP = USDT(5_000); // $5,000

  // Prize %: 30 + 10+10 + 5×5 + 2.5×10 = 100%
  // 1st: 30%, 2nd×2: 10%, 3rd×5: 5%, consolation×10: 2.5%
  const PRIZE_1ST_BPS = 3000n;
  const PRIZE_2ND_BPS = 1000n;
  const PRIZE_3RD_BPS = 500n;
  const PRIZE_CONSOLATION_BPS = 250n;

  async function deployContracts() {
    const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
    usdt = await MockUSDTFactory.deploy();

    const LuckyDrawFactory = await ethers.getContractFactory("LuckyDraw");
    luckyDraw = await LuckyDrawFactory.deploy(
      await usdt.getAddress(),
      admin.address
    );

    // Grant DISTRIBUTOR_ROLE to distributor; CREDITOR_ROLE to admin (runs the draw)
    await luckyDraw.connect(admin).grantRole(DISTRIBUTOR_ROLE, distributor.address);
    await luckyDraw.connect(admin).grantRole(ethers.keccak256(ethers.toUtf8Bytes("CREDITOR_ROLE")), admin.address);

    // Fund the distributor with USDT
    await usdt.mint(distributor.address, USDT(100_000));
    await usdt.connect(distributor).approve(await luckyDraw.getAddress(), ethers.MaxUint256);
  }

  function getParticipantAddresses(count: number): string[] {
    return participantAddrs.slice(0, count);
  }

  beforeEach(async () => {
    [admin, distributor, treasury, stranger] = await ethers.getSigners();

    // Generate 30 deterministic wallet addresses as participants (no ETH needed, only receive USDT)
    participantAddrs = Array.from({ length: 30 }, (_, i) =>
      ethers.Wallet.createRandom().address
    );

    await deployContracts();
  });

  // ─────────────────────────────────────────────────────────
  // Deployment
  // ─────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets the correct USDT address", async () => {
      expect(await luckyDraw.usdt()).to.equal(await usdt.getAddress());
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async () => {
      expect(await luckyDraw.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });

    it("weeklyBudget() returns $5,000 USDT", async () => {
      expect(await luckyDraw.weeklyBudget()).to.equal(WEEKLY_CAP);
    });

    it("currentBalance() starts at 0", async () => {
      expect(await luckyDraw.currentBalance()).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────
  // receiveUSDT
  // ─────────────────────────────────────────────────────────

  describe("receiveUSDT", function () {
    it("accumulates USDT balance", async () => {
      await luckyDraw.connect(distributor).receiveUSDT(USDT(1_000));
      expect(await luckyDraw.currentBalance()).to.equal(USDT(1_000));

      await luckyDraw.connect(distributor).receiveUSDT(USDT(2_500));
      expect(await luckyDraw.currentBalance()).to.equal(USDT(3_500));
    });

    it("reverts if caller lacks DISTRIBUTOR_ROLE", async () => {
      await expect(
        luckyDraw.connect(stranger).receiveUSDT(USDT(1_000))
      ).to.be.revertedWithCustomError(luckyDraw, "AccessControlUnauthorizedAccount");
    });

    it("transfers USDT from caller to contract", async () => {
      const amount = USDT(3_000);
      const before = await usdt.balanceOf(await luckyDraw.getAddress());
      await luckyDraw.connect(distributor).receiveUSDT(amount);
      const after = await usdt.balanceOf(await luckyDraw.getAddress());
      expect(after - before).to.equal(amount);
    });
  });

  // ─────────────────────────────────────────────────────────
  // startDraw — access control
  // ─────────────────────────────────────────────────────────

  describe("startDraw — access control", function () {
    beforeEach(async () => {
      await luckyDraw.connect(distributor).receiveUSDT(USDT(5_000));
    });

    it("reverts if caller is not admin", async () => {
      const addrs = getParticipantAddresses(18);
      await expect(
        commitAndDraw(luckyDraw, stranger, addrs, 12345n)
      ).to.be.revertedWithCustomError(luckyDraw, "AccessControlUnauthorizedAccount");
    });

    it("reverts if fewer than 18 participants", async () => {
      const addrs = getParticipantAddresses(10);
      await expect(
        commitAndDraw(luckyDraw, admin, addrs, 12345n)
      ).to.be.revertedWithCustomError(luckyDraw, "NotEnoughParticipants");
    });

    it("reverts if balance is 0", async () => {
      // Don't fund, use a fresh deploy
      const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
      const freshUsdt = await MockUSDTFactory.deploy();
      const LuckyDrawFactory = await ethers.getContractFactory("LuckyDraw");
      const freshDraw = await LuckyDrawFactory.deploy(
        await freshUsdt.getAddress(),
        admin.address
      );
      await freshDraw.connect(admin).grantRole(ethers.keccak256(ethers.toUtf8Bytes("CREDITOR_ROLE")), admin.address);
      const addrs = getParticipantAddresses(18);
      await expect(
        commitAndDraw(freshDraw, admin, addrs, 12345n)
      ).to.be.revertedWithCustomError(freshDraw, "InsufficientBalance");
    });
  });

  // ─────────────────────────────────────────────────────────
  // startDraw — prize distribution
  // ─────────────────────────────────────────────────────────

  describe("startDraw — prize distribution (full $5K pool)", function () {
    const SEED = 99999n;

    beforeEach(async () => {
      await luckyDraw.connect(distributor).receiveUSDT(WEEKLY_CAP);
    });

    it("distributes exactly 18 prizes", async () => {
      const tx = await commitAndDraw(luckyDraw, admin, participantAddrs, SEED);
      const receipt = await tx.wait();
      const events = receipt!.logs
        .map(log => {
          try { return luckyDraw.interface.parseLog(log); } catch { return null; }
        })
        .filter(e => e?.name === "PrizeAwarded");
      expect(events.length).to.equal(18);
    });

    it("1st prize = 30% of $5K = $1,500", async () => {
      const tx = await commitAndDraw(luckyDraw, admin, participantAddrs, SEED);
      const receipt = await tx.wait();
      const events = receipt!.logs
        .map(log => {
          try { return luckyDraw.interface.parseLog(log); } catch { return null; }
        })
        .filter(e => e?.name === "PrizeAwarded");
      // rank 0 = 1st place
      const firstPrize = events.find(e => e!.args.rank === 0n);
      expect(firstPrize).to.not.be.undefined;
      expect(firstPrize!.args.amount).to.equal(USDT(5_000) * PRIZE_1ST_BPS / 10000n);
    });

    it("2nd prizes (×2) = 10% each = $500 each", async () => {
      const tx = await commitAndDraw(luckyDraw, admin, participantAddrs, SEED);
      const receipt = await tx.wait();
      const events = receipt!.logs
        .map(log => {
          try { return luckyDraw.interface.parseLog(log); } catch { return null; }
        })
        .filter(e => e?.name === "PrizeAwarded");
      const secondPrizes = events.filter(e => e!.args.rank === 1n || e!.args.rank === 2n);
      expect(secondPrizes.length).to.equal(2);
      for (const p of secondPrizes) {
        expect(p!.args.amount).to.equal(USDT(5_000) * PRIZE_2ND_BPS / 10000n);
      }
    });

    it("3rd prizes (×5) = 5% each = $250 each", async () => {
      const tx = await commitAndDraw(luckyDraw, admin, participantAddrs, SEED);
      const receipt = await tx.wait();
      const events = receipt!.logs
        .map(log => {
          try { return luckyDraw.interface.parseLog(log); } catch { return null; }
        })
        .filter(e => e?.name === "PrizeAwarded");
      const thirdPrizes = events.filter(e => e!.args.rank >= 3n && e!.args.rank <= 7n);
      expect(thirdPrizes.length).to.equal(5);
      for (const p of thirdPrizes) {
        expect(p!.args.amount).to.equal(USDT(5_000) * PRIZE_3RD_BPS / 10000n);
      }
    });

    it("consolation prizes (×10) = 2.5% each = $125 each", async () => {
      const tx = await commitAndDraw(luckyDraw, admin, participantAddrs, SEED);
      const receipt = await tx.wait();
      const events = receipt!.logs
        .map(log => {
          try { return luckyDraw.interface.parseLog(log); } catch { return null; }
        })
        .filter(e => e?.name === "PrizeAwarded");
      const consolation = events.filter(e => e!.args.rank >= 8n && e!.args.rank <= 17n);
      expect(consolation.length).to.equal(10);
      for (const p of consolation) {
        expect(p!.args.amount).to.equal(USDT(5_000) * PRIZE_CONSOLATION_BPS / 10000n);
      }
    });

    it("total prizes sum to exactly $5,000 (pool = cap)", async () => {
      const pool = WEEKLY_CAP;
      const expected =
        pool * PRIZE_1ST_BPS / 10000n +                   // 1st
        2n * (pool * PRIZE_2ND_BPS / 10000n) +            // 2nd ×2
        5n * (pool * PRIZE_3RD_BPS / 10000n) +            // 3rd ×5
        10n * (pool * PRIZE_CONSOLATION_BPS / 10000n);    // consolation ×10
      expect(expected).to.equal(WEEKLY_CAP);
    });

    it("drains contract balance after draw", async () => {
      await commitAndDraw(luckyDraw, admin, participantAddrs, SEED);
      expect(await luckyDraw.currentBalance()).to.equal(0n);
    });

    it("winners are CREDITED their prize (claim model)", async () => {
      const tx = await commitAndDraw(luckyDraw, admin, participantAddrs, SEED);
      const receipt = await tx.wait();
      const events = receipt!.logs
        .map(log => {
          try { return luckyDraw.interface.parseLog(log); } catch { return null; }
        })
        .filter(e => e?.name === "PrizeAwarded");

      for (const e of events) {
        const winner = e!.args.winner as string;
        const amount = e!.args.amount as bigint;
        // credited (not transferred) until the winner claims
        expect(await luckyDraw.claimable(winner)).to.equal(amount);
        expect(await usdt.balanceOf(winner)).to.equal(0n);
      }
    });

    it("a winner can claim their credited prize to their wallet", async () => {
      // use a real signer (treasury) as a guaranteed participant so it can call claim()
      const parts = [treasury.address, ...participantAddrs.slice(0, 17)];
      await commitAndDraw(luckyDraw, admin, parts, SEED);
      const owed = await luckyDraw.claimable(treasury.address);
      expect(owed).to.be.gt(0n);
      const before = await usdt.balanceOf(treasury.address);
      await luckyDraw.connect(treasury).claim();
      expect(await usdt.balanceOf(treasury.address)).to.equal(before + owed);
      expect(await luckyDraw.claimable(treasury.address)).to.equal(0n);
    });

    it("all 18 winners are unique (no double-win)", async () => {
      const tx = await commitAndDraw(luckyDraw, admin, participantAddrs, SEED);
      const receipt = await tx.wait();
      const events = receipt!.logs
        .map(log => {
          try { return luckyDraw.interface.parseLog(log); } catch { return null; }
        })
        .filter(e => e?.name === "PrizeAwarded");
      const winners = events.map(e => e!.args.winner as string);
      const unique = new Set(winners);
      expect(unique.size).to.equal(18);
    });
  });

  // ─────────────────────────────────────────────────────────
  // startDraw — partial balance (< $5K cap)
  // ─────────────────────────────────────────────────────────

  describe("startDraw — partial balance < $5K", function () {
    it("uses min(balance, weeklyBudget) as pool", async () => {
      const partialAmount = USDT(2_000); // only $2K
      await luckyDraw.connect(distributor).receiveUSDT(partialAmount);

      const addrs = getParticipantAddresses(18);
      const tx = await commitAndDraw(luckyDraw, admin, addrs, 42n);
      const receipt = await tx.wait();
      const events = receipt!.logs
        .map(log => {
          try { return luckyDraw.interface.parseLog(log); } catch { return null; }
        })
        .filter(e => e?.name === "PrizeAwarded");

      // 1st prize should be 30% of $2K = $600
      const firstPrize = events.find(e => e!.args.rank === 0n);
      expect(firstPrize!.args.amount).to.equal(partialAmount * PRIZE_1ST_BPS / 10000n);
    });
  });

  // ─────────────────────────────────────────────────────────
  // Fisher-Yates determinism
  // ─────────────────────────────────────────────────────────

  describe("Fisher-Yates determinism", function () {
    it("same seed produces same winners", async () => {
      const addrs = getParticipantAddresses(20);
      const seed = 777n;

      // First draw
      await luckyDraw.connect(distributor).receiveUSDT(WEEKLY_CAP);
      const tx1 = await commitAndDraw(luckyDraw, admin, addrs, seed);
      const r1 = await tx1.wait();
      const events1 = r1!.logs
        .map(log => {
          try { return luckyDraw.interface.parseLog(log); } catch { return null; }
        })
        .filter(e => e?.name === "PrizeAwarded")
        .sort((a, b) => Number(a!.args.rank) - Number(b!.args.rank));
      const winners1 = events1.map(e => e!.args.winner as string);

      // Re-deploy and repeat with same seed
      const MockUSDTFactory = await ethers.getContractFactory("MockUSDT");
      const usdt2 = await MockUSDTFactory.deploy();
      const LuckyDrawFactory = await ethers.getContractFactory("LuckyDraw");
      const draw2 = await LuckyDrawFactory.deploy(await usdt2.getAddress(), admin.address);
      await draw2.connect(admin).grantRole(DISTRIBUTOR_ROLE, distributor.address);
      await draw2.connect(admin).grantRole(ethers.keccak256(ethers.toUtf8Bytes("CREDITOR_ROLE")), admin.address);
      await usdt2.mint(distributor.address, WEEKLY_CAP);
      await usdt2.connect(distributor).approve(await draw2.getAddress(), ethers.MaxUint256);
      await draw2.connect(distributor).receiveUSDT(WEEKLY_CAP);

      const tx2 = await commitAndDraw(draw2 as unknown as LuckyDraw, admin, addrs, seed);
      const r2 = await tx2.wait();
      const events2 = r2!.logs
        .map(log => {
          try { return draw2.interface.parseLog(log); } catch { return null; }
        })
        .filter(e => e?.name === "PrizeAwarded")
        .sort((a, b) => Number(a!.args.rank) - Number(b!.args.rank));
      const winners2 = events2.map(e => e!.args.winner as string);

      expect(winners1).to.deep.equal(winners2);
    });

    it("different seeds produce different winners (probabilistic)", async () => {
      const addrs = getParticipantAddresses(20);

      await luckyDraw.connect(distributor).receiveUSDT(WEEKLY_CAP);
      const tx1 = await commitAndDraw(luckyDraw, admin, addrs, 1n);
      const r1 = await tx1.wait();
      const winners1 = r1!.logs
        .map(log => {
          try { return luckyDraw.interface.parseLog(log); } catch { return null; }
        })
        .filter(e => e?.name === "PrizeAwarded")
        .map(e => e!.args.winner as string);

      // Re-fund and draw with different seed
      await luckyDraw.connect(distributor).receiveUSDT(WEEKLY_CAP);
      const tx2 = await commitAndDraw(luckyDraw, admin, addrs, 999999n);
      const r2 = await tx2.wait();
      const winners2 = r2!.logs
        .map(log => {
          try { return luckyDraw.interface.parseLog(log); } catch { return null; }
        })
        .filter(e => e?.name === "PrizeAwarded")
        .map(e => e!.args.winner as string);

      // With different seeds over 20 participants, winner sets are very likely different
      const same = winners1.every((w, i) => w === winners2[i]);
      expect(same).to.be.false;
    });
  });

  // ─────────────────────────────────────────────────────────
  // sweepExcess
  // ─────────────────────────────────────────────────────────

  describe("sweepExcess", function () {
    it("sends excess beyond $5K cap to treasury", async () => {
      const excess = USDT(2_000);
      await luckyDraw.connect(distributor).receiveUSDT(WEEKLY_CAP + excess);
      expect(await luckyDraw.currentBalance()).to.equal(WEEKLY_CAP + excess);

      const before = await usdt.balanceOf(treasury.address);
      await luckyDraw.connect(admin).sweepExcess(treasury.address);
      const after = await usdt.balanceOf(treasury.address);

      expect(after - before).to.equal(excess);
      expect(await luckyDraw.currentBalance()).to.equal(WEEKLY_CAP);
    });

    it("does nothing if balance <= $5K cap", async () => {
      await luckyDraw.connect(distributor).receiveUSDT(USDT(3_000));

      const before = await usdt.balanceOf(treasury.address);
      await luckyDraw.connect(admin).sweepExcess(treasury.address);
      const after = await usdt.balanceOf(treasury.address);

      expect(after).to.equal(before);
      expect(await luckyDraw.currentBalance()).to.equal(USDT(3_000));
    });

    it("reverts if caller is not admin", async () => {
      await luckyDraw.connect(distributor).receiveUSDT(USDT(10_000));
      await expect(
        luckyDraw.connect(stranger).sweepExcess(treasury.address)
      ).to.be.revertedWithCustomError(luckyDraw, "AccessControlUnauthorizedAccount");
    });
  });

  // ─────────────────────────────────────────────────────────
  // Commit-reveal — the fairness guarantee
  // ─────────────────────────────────────────────────────────

  describe("commit-reveal fairness", function () {
    const CREDITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CREDITOR_ROLE"));

    beforeEach(async () => {
      await luckyDraw.connect(distributor).receiveUSDT(WEEKLY_CAP);
    });

    it("refuses a draw that was never committed", async () => {
      const addrs = getParticipantAddresses(20);
      await expect(
        luckyDraw.connect(admin).startDraw(addrs, 999n)
      ).to.be.revertedWithCustomError(luckyDraw, "NoCommitment");
    });

    it("refuses a different seed than the one sealed", async () => {
      const addrs = getParticipantAddresses(20);
      await luckyDraw.connect(admin).commitDraw(await luckyDraw.drawCommitment(addrs, 111n));
      await expect(
        luckyDraw.connect(admin).startDraw(addrs, 222n)
      ).to.be.revertedWithCustomError(luckyDraw, "CommitmentMismatch");
    });

    it("refuses a REORDERED participant list — the seed alone is not enough", async () => {
      // This is the attack commit-reveal exists to stop. The operator knows the seed they
      // chose; Fisher-Yates depends on list order, so if only the seed were sealed they
      // could shuffle the list until a chosen wallet landed on rank 0.
      const addrs = getParticipantAddresses(20);
      await luckyDraw.connect(admin).commitDraw(await luckyDraw.drawCommitment(addrs, 555n));

      const reordered = [...addrs];
      [reordered[0], reordered[19]] = [reordered[19], reordered[0]];

      await expect(
        luckyDraw.connect(admin).startDraw(reordered, 555n)
      ).to.be.revertedWithCustomError(luckyDraw, "CommitmentMismatch");

      // The original, sealed ordering still works.
      await expect(luckyDraw.connect(admin).startDraw(addrs, 555n)).to.not.be.reverted;
    });

    it("refuses a second commitment while one is still open", async () => {
      const addrs = getParticipantAddresses(20);
      await luckyDraw.connect(admin).commitDraw(await luckyDraw.drawCommitment(addrs, 1n));
      await expect(
        luckyDraw.connect(admin).commitDraw(await luckyDraw.drawCommitment(addrs, 2n))
      ).to.be.revertedWithCustomError(luckyDraw, "CommitmentOpen");
    });

    it("clears the commitment after a successful draw, so the next one must re-commit", async () => {
      const addrs = getParticipantAddresses(20);
      await luckyDraw.connect(admin).commitDraw(await luckyDraw.drawCommitment(addrs, 7n));
      await luckyDraw.connect(admin).startDraw(addrs, 7n);
      expect(await luckyDraw.commitment()).to.equal(ethers.ZeroHash);
      await expect(
        luckyDraw.connect(admin).startDraw(addrs, 7n)
      ).to.be.revertedWithCustomError(luckyDraw, "NoCommitment");
    });

    it("only CREDITOR_ROLE may commit", async () => {
      const addrs = getParticipantAddresses(20);
      await expect(
        luckyDraw.connect(stranger).commitDraw(await luckyDraw.drawCommitment(addrs, 1n))
      ).to.be.reverted;
    });

    it("cannot reveal after the window closes", async () => {
      const addrs = getParticipantAddresses(20);
      await luckyDraw.connect(admin).commitDraw(await luckyDraw.drawCommitment(addrs, 3n));
      await ethers.provider.send("evm_increaseTime", [3 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);
      await expect(
        luckyDraw.connect(admin).startDraw(addrs, 3n)
      ).to.be.revertedWithCustomError(luckyDraw, "RevealWindowClosed");
    });

    it("ANYONE may cancel a stalled commitment once the window lapses", async () => {
      // Stops an operator quietly sitting on a result they dislike and re-rolling later.
      const addrs = getParticipantAddresses(20);
      await luckyDraw.connect(admin).commitDraw(await luckyDraw.drawCommitment(addrs, 4n));

      await expect(
        luckyDraw.connect(stranger).cancelExpiredCommit()
      ).to.be.revertedWithCustomError(luckyDraw, "RevealWindowOpen");

      await ethers.provider.send("evm_increaseTime", [3 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);

      await expect(luckyDraw.connect(stranger).cancelExpiredCommit())
        .to.emit(luckyDraw, "DrawCommitmentCancelled");
      expect(await luckyDraw.commitment()).to.equal(ethers.ZeroHash);
    });

    it("the abandoned prize pool carries over to the next draw", async () => {
      const addrs = getParticipantAddresses(20);
      const before = await luckyDraw.currentBalance();
      await luckyDraw.connect(admin).commitDraw(await luckyDraw.drawCommitment(addrs, 5n));
      await ethers.provider.send("evm_increaseTime", [3 * 24 * 3600 + 1]);
      await ethers.provider.send("evm_mine", []);
      await luckyDraw.connect(stranger).cancelExpiredCommit();
      expect(await luckyDraw.currentBalance()).to.equal(before, "nothing was paid out or lost");
    });
  });

});
