import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // ── Default Round Configs ───────────────────────────────────────
  const rounds = [
    { roundType: "SEED",    status: "ACTIVE",  displayCap: 500000,    micPrice: 0.0025 },
    { roundType: "PRESALE", status: "UPCOMING",  displayCap: 1575000,   micPrice: 0.005 },
    { roundType: "MICE",    status: "UPCOMING",  displayCap: 100000 },
    { roundType: "MINING",  status: "UPCOMING" },
    { roundType: "STAKING", status: "UPCOMING" },
    { roundType: "DAO",     status: "UPCOMING" },
  ];

  for (const r of rounds) {
    await prisma.roundConfig.upsert({
      where: { roundType: r.roundType },
      update: {},
      create: {
        roundType: r.roundType,
        status: r.status,
        displayCap: r.displayCap ?? null,
        micPrice: r.micPrice ?? null,
      },
    });
  }
  console.log("✅ Seeded 6 RoundConfig entries");

  // ── Default System Configs ──────────────────────────────────────
  const configs = [
    // General
    { key: "swap_enabled", value: "false" },
    { key: "mic_price_mode", value: "admin" }, // admin | twap
    { key: "mic_price", value: "0.0085" },
    { key: "nira_bot_name", value: "NIRA" },
    { key: "nira_language", value: "auto" },
    { key: "alert_threshold_pct", value: "15" },
    { key: "auto_buyback", value: "true" },
    { key: "auto_burn", value: "true" },
    // Tokenomics (Admin-adjustable, defaults match whitepaper)
    { key: "total_supply", value: "7000000000" },
    { key: "pre_issued", value: "1050000000" },
    { key: "mining_pool", value: "5950000000" },
    { key: "mfp_total", value: "25000" },
    { key: "mice_max_supply", value: "100000" },
    // Emission split %
    { key: "emission_miners_pct", value: "60" },
    { key: "emission_staking_pct", value: "20" },
    { key: "emission_dao_pct", value: "15" },
    { key: "emission_burn_pct", value: "5" },
    // Daily output (MIC/day) — Admin adjusts, default from E₀
    { key: "daily_output", value: "22907500" },
  ];

  for (const c of configs) {
    await prisma.systemConfig.upsert({
      where: { key: c.key },
      update: {},
      create: { key: c.key, value: c.value },
    });
  }
  console.log(`✅ Seeded ${configs.length} SystemConfig entries`);

  // ── Default Admin Board (Owner) ─────────────────────────────────
  await prisma.adminBoard.upsert({
    where: { wallet: "0x0000000000000000000000000000000000000000" },
    update: {},
    create: {
      wallet: "0x0000000000000000000000000000000000000000",
      username: "Owner",
      role: "OWNER",
      votePower: 100,
      status: "ACTIVE",
      notes: "Default owner placeholder — replace with real wallet",
    },
  });
  console.log("✅ Seeded default AdminBoard owner");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
