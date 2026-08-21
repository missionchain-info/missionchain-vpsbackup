import { expect } from "chai";
import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const DAY = 86_400;
const e18 = (n: string | number) => ethers.parseEther(String(n));
const FLAT = 100_000n;   // the MFP pool's deployed flatWeight

describe("MFPNftAdapter — moving the MFP pool to self-service", () => {
  let mfp: any, adapter: any, pool: any, mic: any;
  let admin: any, emitter: any, alice: any, bob: any, stranger: any;

  // The adapter reports a fixed far-future expiry (2100-01-01) because NftRewardPoolV2
  // stores expiries as uint64 and orders a heap by them, so `type(uint256).max` would
  // truncate into the past. Run inside the whole suite, `time.increase` accumulates across
  // ~1,650 tests and the chain clock reaches 2255 — past that horizon, so every enrol here
  // failed with "already expired". Reset the chain so these tests measure the contract and
  // not the order they happen to run in.
  before(async () => {
    await network.provider.send("hardhat_reset");
  });

  beforeEach(async () => {
    [admin, emitter, alice, bob, stranger] = await ethers.getSigners();

    mic = await (await ethers.getContractFactory("MICToken")).deploy(admin.address);
    mfp = await (await ethers.getContractFactory("MockNFT721")).deploy();
    adapter = await (await ethers.getContractFactory("MFPNftAdapter")).deploy(await mfp.getAddress());

    // Deployed exactly as mainnet's MFP pool is: flat-weight, no NFT.
    pool = await (await ethers.getContractFactory("NftRewardPoolV2"))
      .deploy(await mic.getAddress(), ethers.ZeroAddress, FLAT, admin.address);
    await pool.connect(admin).grantRole(await pool.EMISSION_ROLE(), emitter.address);
    await mic.connect(admin).grantRole(await mic.MINTER_ROLE(), admin.address);
  });

  const fund = async (amount: string) => {
    await mic.connect(admin).mintFromMining(await pool.getAddress(), e18(amount));
    await pool.connect(emitter).notifyReward(e18(amount));
  };

  describe("the translation", () => {
    it("forwards ownership — the fact enroll credits", async () => {
      await mfp.mint(alice.address, 21);
      expect(await adapter.ownerOf(21)).to.equal(alice.address);
    });

    it("reverts for a token that does not exist", async () => {
      await expect(adapter.ownerOf(999)).to.be.reverted;
    });

    it("answers every pass identically — they are undifferentiated", async () => {
      expect(await adapter.tierOf(1)).to.equal(await adapter.tierOf(999));
      expect(await adapter.tierMultiplier(1)).to.equal(await adapter.tierMultiplier(7));
      expect(await adapter.tierMultiplier(1)).to.equal(10_000n);
    });

    it("gives an expiry that survives the pool's uint64 heap", async () => {
      const never = await adapter.expiresAt(21);
      expect(never).to.be.gt(BigInt(await time.latest()));
      expect(BigInt.asUintN(64, never)).to.equal(never);   // type(uint256).max would not
    });

    it("has no setter and holds nothing", async () => {
      expect(await mic.balanceOf(await adapter.getAddress())).to.equal(0n);
      const setters = adapter.interface.fragments
        .filter((f: any) => f.type === "function" && /^set/i.test(f.name ?? ""));
      expect(setters.length).to.equal(0);
    });
  });

  describe("the two modes are mutually exclusive", () => {
    it("flat mode: only admin can write weight, and enroll is refused", async () => {
      await mfp.mint(alice.address, 21);
      await expect(pool.connect(alice).enroll(21)).to.be.revertedWith("NRP: not an NFT pool");
      await expect(pool.connect(alice).setWeight(alice.address, 1)).to.be.reverted;
      await expect(pool.connect(admin).setWeight(alice.address, 1)).to.not.be.reverted;
      expect(await pool.weightOf(alice.address)).to.equal(FLAT);
    });

    it("NFT mode: setWeight closes, and holders serve themselves", async () => {
      await pool.connect(admin).setNft(await adapter.getAddress());
      await expect(pool.connect(admin).setWeight(alice.address, 1))
        .to.be.revertedWith("NRP: NFT pool uses enroll()");

      await mfp.mint(alice.address, 21);
      await expect(pool.connect(alice).enroll(21)).to.not.be.reverted;
      expect(await pool.weightOf(alice.address)).to.equal(10_000n);
    });
  });

  describe("the migration, in the order it will run on mainnet", () => {
    it("zeroes, switches, and enrols everyone in one batch — with no race", async () => {
      // Flat mode, weight written by the operator.
      for (const [who, ids] of [[alice, [1, 2]], [bob, [3]]] as const) {
        for (const id of ids) await mfp.mint(who.address, id);
        await pool.connect(admin).setWeight(who.address, ids.length);
      }
      expect(await pool.totalWeight()).to.equal(3n * FLAT);

      // 1 — zero every wallet, or enrolment would stack on top of the old weight.
      for (const who of [alice, bob]) await pool.connect(admin).setWeight(who.address, 0);
      expect(await pool.totalWeight()).to.equal(0n);

      // 2 — switch modes.
      await pool.connect(admin).setNft(await adapter.getAddress());

      // 3 — enrol every token. `enroll` credits nft.ownerOf, NOT msg.sender, so a
      //     stranger can migrate the whole collection and no holder has to be quick.
      await pool.connect(stranger).enrollBatch([1, 2, 3]);

      expect(await pool.weightOf(alice.address)).to.equal(20_000n);
      expect(await pool.weightOf(bob.address)).to.equal(10_000n);
      expect(await pool.totalWeight()).to.equal(30_000n);
    });

    it("loses nothing while weight is zero — it carries over", async () => {
      await mfp.mint(alice.address, 1);
      await pool.connect(admin).setWeight(alice.address, 1);
      await fund("100");

      await pool.connect(admin).setWeight(alice.address, 0);   // the migration window opens
      await time.increase(6 * 3600);                            // six hours with no holders

      // The carry is not accrued by the passage of time — it is booked when something
      // touches the pool. Nothing is at risk: notifyReward calls _sync() before it does
      // anything else, so the next distribution always sweeps the window up. sync() is
      // permissionless and does it explicitly here.
      await pool.sync();
      const carried = await pool.carryOver();
      expect(carried).to.be.gt(0n);

      await pool.connect(admin).setNft(await adapter.getAddress());
      await pool.enrollBatch([1]);

      // The carry is folded into the next notification rather than burned.
      await fund("10");
      expect(await pool.carryOver()).to.equal(0n);
      await time.increase(DAY);
      expect(await pool.claimable(alice.address)).to.be.gt(e18("10"));
    });

    it("double-counts if the zeroing step is skipped — the reason it is step one", async () => {
      await mfp.mint(alice.address, 1);
      await pool.connect(admin).setWeight(alice.address, 1);   // 100,000
      await pool.connect(admin).setNft(await adapter.getAddress());
      await pool.enrollBatch([1]);                              // + 10,000

      expect(await pool.weightOf(alice.address)).to.equal(FLAT + 10_000n);
      expect(await pool.weightOf(alice.address)).to.not.equal(10_000n);
    });
  });

  describe("what the holder gains", () => {
    beforeEach(async () => {
      await pool.connect(admin).setNft(await adapter.getAddress());
    });

    it("a buyer moves the weight themselves, with no operator", async () => {
      await mfp.mint(alice.address, 21);
      await pool.connect(alice).enroll(21);
      await mfp.connect(alice).transferFrom(alice.address, bob.address, 21);

      // Until someone calls resync the pool still credits the seller — the honest default.
      expect(await pool.weightOf(alice.address)).to.equal(10_000n);

      await pool.connect(bob).resync(21);          // the buyer, unaided
      expect(await pool.weightOf(alice.address)).to.equal(0n);
      expect(await pool.weightOf(bob.address)).to.equal(10_000n);
    });

    it("splits a real distribution by pass count", async () => {
      for (const [who, ids] of [[alice, [1, 2]], [bob, [3]]] as const) {
        for (const id of ids) await mfp.mint(who.address, id);
      }
      await pool.enrollBatch([1, 2, 3]);
      await fund("300");
      await time.increase(DAY);

      expect(await pool.claimable(alice.address)).to.be.closeTo(e18("200"), e18("0.5"));
      expect(await pool.claimable(bob.address)).to.be.closeTo(e18("100"), e18("0.5"));
    });

    it("pays out to the wallet", async () => {
      await mfp.mint(alice.address, 21);
      await pool.enrollBatch([21]);
      await fund("100");
      await time.increase(DAY);

      const before = await mic.balanceOf(alice.address);
      await pool.connect(alice).claim();
      expect((await mic.balanceOf(alice.address)) - before).to.be.closeTo(e18("100"), e18("0.5"));
    });
  });
});
