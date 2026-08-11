import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

/**
 * Every contract that compares an incoming amount against a hardcoded dollar figure is
 * only correct for one token scale. BSC-USD — the token all of these actually meet on
 * mainnet — is **18 decimals**, not the 6 that USDT uses on Ethereum.
 *
 * Getting that wrong is not a rounding error, it is a total loss. `PreSale` priced its
 * hard cap at `1_575_000e6`; against the real token the first buyer could have taken all
 * 315,000,000 MIC for 0.000001575 USDT in one call. The live `SeedSaleV7` shipped with
 * the same defect and had to be halted on mainnet on 2026-08-08 (tx 0xc931ff25…72613a)
 * with 181,558,850 MIC exposed.
 *
 * The ordinary test suite cannot catch this. `decimals()` is metadata — it takes no part
 * in transfer arithmetic — so a suite that mints `1000e6` and asserts `1000e6` passes
 * happily no matter what the mock reports. The bug lives in the gap between the
 * contract's constants and what a real wallet sends for "$1,000", and only a constructor
 * guard closes it.
 *
 * These tests exist so that reverting a constant to `e6` fails loudly instead of silently.
 */
/** Minimal wiring for the two priced contracts in the MICE / SWAP batch. */
async function setupMice() {
  const [admin] = await ethers.getSigners();
  const usdt18 = await (await ethers.getContractFactory("MockUSDT")).deploy();
  const usdt6 = await (await ethers.getContractFactory("MockUSDT6")).deploy();
  const mic = await (await ethers.getContractFactory("MICToken")).deploy(admin.address);
  const pool = await (await ethers.getContractFactory("MockLiquidityPoolV6")).deploy();
  const registry = await (await ethers.getContractFactory("ReferralRegistry"))
    .deploy(await usdt18.getAddress(), admin.address);
  const routerMock = await (await ethers.getContractFactory("MockRewardReceiver"))
    .deploy(await usdt18.getAddress());

  const F = await ethers.getContractFactory("MICELicense");
  const mice = await F.deploy(
    await usdt18.getAddress(),
    await mic.getAddress(),
    await registry.getAddress(),
    await routerMock.getAddress(),
    admin.address,
    await pool.getAddress(),
    ethers.parseEther("0.01"),
  );
  return {
    mice,
    usdt6: await usdt6.getAddress(),
    mic: await mic.getAddress(),
    pool: await pool.getAddress(),
    registry: await registry.getAddress(),
    router: await routerMock.getAddress(),
    admin: admin.address,
  };
}

describe("USDT decimals guard", () => {
  let admin: SignerWithAddress;
  let usdt18: any, usdt6: any;

  const ZERO = "0x0000000000000000000000000000000000000001"; // non-zero filler

  beforeEach(async () => {
    [admin] = await ethers.getSigners();
    usdt18 = await (await ethers.getContractFactory("MockUSDT")).deploy();
    usdt6 = await (await ethers.getContractFactory("MockUSDT6")).deploy();
  });

  it("the production mock is 18 decimals, matching BSC-USD", async () => {
    expect(await usdt18.decimals()).to.equal(18);
  });

  describe("ReferralRegistry", () => {
    it("deploys against an 18-decimal token", async () => {
      const F = await ethers.getContractFactory("ReferralRegistry");
      await F.deploy(await usdt18.getAddress(), admin.address);
    });

    it("refuses a 6-decimal token", async () => {
      const F = await ethers.getContractFactory("ReferralRegistry");
      await expect(F.deploy(await usdt6.getAddress(), admin.address))
        .to.be.revertedWith("Ref: usdt must be 18 decimals");
    });

    it("its GV ladder is denominated so $5,000 is Tier 1, not Tier 5", async () => {
      const F = await ethers.getContractFactory("ReferralRegistry");
      const r: any = await F.deploy(await usdt18.getAddress(), admin.address);
      // The whole point: a real $5,000 must land ON the first threshold, not blow past
      // the last one. With the old `* 1e6` constants, $25 already cleared Legend.
      expect(await r.TIER1_THRESHOLD()).to.equal(ethers.parseEther("5000"));
      expect(await r.TIER5_THRESHOLD()).to.equal(ethers.parseEther("500000"));
      expect(await r.TIER5_THRESHOLD()).to.be.greaterThan(ethers.parseEther("25"));
    });
  });

  describe("LuckyDraw", () => {
    it("deploys against an 18-decimal token", async () => {
      const F = await ethers.getContractFactory("LuckyDraw");
      await F.deploy(await usdt18.getAddress(), admin.address);
    });

    it("refuses a 6-decimal token", async () => {
      const F = await ethers.getContractFactory("LuckyDraw");
      await expect(F.deploy(await usdt6.getAddress(), admin.address))
        .to.be.revertedWith("LuckyDraw: usdt must be 18 decimals");
    });

    it("its weekly cap is a real $5,000", async () => {
      const F = await ethers.getContractFactory("LuckyDraw");
      const d: any = await F.deploy(await usdt18.getAddress(), admin.address);
      expect(await d.WEEKLY_CAP()).to.equal(ethers.parseEther("5000"));
    });
  });

  describe("PreSale", () => {
    async function deps() {
      const mic = await (await ethers.getContractFactory("MockUSDT")).deploy();
      return [
        await mic.getAddress(), ZERO, ZERO, ZERO, ZERO, admin.address,
      ] as const;
    }

    it("refuses a 6-decimal token", async () => {
      const [micA, lock, cnft, reg, router, adm] = await deps();
      const F = await ethers.getContractFactory("PreSale");
      await expect(
        F.deploy(await usdt6.getAddress(), micA, lock, cnft, reg, router, adm),
      ).to.be.revertedWith("PS: usdt must be 18 decimals");
    });

    it("its hard cap is a real $1,575,000, not a millionth of a dollar", async () => {
      const [micA, lock, cnft, reg, router, adm] = await deps();
      const F = await ethers.getContractFactory("PreSale");
      const ps: any = await F.deploy(await usdt18.getAddress(), micA, lock, cnft, reg, router, adm);
      expect(await ps.HARD_CAP()).to.equal(ethers.parseEther("1575000"));

      // The cap must be worth strictly more than the allocation is priced at, per MIC:
      // 315,000,000 MIC × $0.005 = $1,575,000. If the cap ever drops below one dollar
      // again, the allocation is buyable for dust.
      expect(await ps.HARD_CAP()).to.be.greaterThan(ethers.parseEther("1"));
      expect(await ps.ALLOCATION()).to.equal(ethers.parseEther("315000000"));
    });
  });

  describe("MICELicense", () => {
    it("refuses a 6-decimal token", async () => {
      const { usdt6, mic, pool, registry, router, admin } = await loadFixture(setupMice);
      const F = await ethers.getContractFactory("MICELicense");
      await expect(
        F.deploy(usdt6, mic, registry, router, admin, pool, ethers.parseEther("0.01")),
      ).to.be.revertedWith("MICE: usdt must be 18 decimals");
    });

    it("prices a licence at a real $100, not a ten-billionth of a cent", async () => {
      const { mice } = await loadFixture(setupMice);
      // Written as `100 * 1_000_000` this was 0.0000000001 USDT, and all five rounds of
      // 100,000 licences would have sold for nothing.
      expect(await mice.getPriceForRound(1n)).to.equal(ethers.parseEther("100"));
      expect(await mice.getPriceForRound(5n)).to.equal(ethers.parseEther("500"));
      expect(await mice.getPriceForRound(1n)).to.be.greaterThan(ethers.parseEther("1"));
    });
  });

  describe("LiquidityPoolV6", () => {
    it("refuses a 6-decimal token", async () => {
      const { usdt6, mic, admin } = await loadFixture(setupMice);
      const F = await ethers.getContractFactory("LiquidityPoolV6");
      await expect(
        F.deploy(usdt6, mic, ethers.parseEther("500000"), admin),
      ).to.be.revertedWith("LP6: usdt must be 18 decimals");
    });

    it("its listing threshold is a real $10,000,000", async () => {
      const F = await ethers.getContractFactory("LiquidityPoolV6");
      const pool = await F.deploy(
        (await (await ethers.getContractFactory("MockUSDT")).deploy()).getAddress(),
        (await (await ethers.getContractFactory("MICToken")).deploy(
          (await ethers.getSigners())[0].address)).getAddress(),
        ethers.parseEther("500000"),
        (await ethers.getSigners())[0].address,
      );
      // At 6 decimals this constant meant $0.00001, so the pool left Bootstrap for
      // Listed on the first deposit instead of at ten million dollars of reserves.
      expect(await pool.LISTING_THRESHOLD()).to.equal(ethers.parseEther("10000000"));
    });
  });

  it("no contract in the priced set accepts a 6-decimal token", async () => {
    const usdt6Addr = await usdt6.getAddress();
    const cases: Array<[string, any[]]> = [
      ["ReferralRegistry", [usdt6Addr, admin.address]],
      ["LuckyDraw", [usdt6Addr, admin.address]],
      ["PreSale", [usdt6Addr, await usdt18.getAddress(), ZERO, ZERO, ZERO, ZERO, admin.address]],
    ];
    for (const [name, args] of cases) {
      const F = await ethers.getContractFactory(name);
      await expect(F.deploy(...args), `${name} accepted a 6-decimal token`).to.be.reverted;
    }
  });
});
