/**
 * ============================================================
 *  MissionChain — Orchestra Telegram Bridge v4.0
 *  2-way Telegram interface for Orchestra commands
 *  Updated: phase names match MissionChain codebase structure
 *           + cost commands, budget-aware
 * ============================================================
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), override: true });
const TelegramBot = require("node-telegram-bot-api");
const { Orchestra, CostTracker } = require("./orchestra");
const { OrchestraScheduler } = require("./scheduler");
const fs = require("fs");
const path = require("path");

// ============ Config ============

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("[Orchestra-TG] TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID required in .env");
  process.exit(1);
}

// ============ Bot Setup ============

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
let orchestra;
try {
  orchestra = new Orchestra();
} catch (err) {
  console.error(`[Orchestra-TG] Warning: ${err.message} — audit commands will fail until API keys are set`);
  orchestra = null;
}

const scheduler = new OrchestraScheduler();
let isAuditing = false;

console.log("============================================");
console.log("  MissionChain AI Orchestra — Telegram v4.0");
console.log("  Listening for commands...");
console.log("============================================\n");

// ============ Auth Check ============

function isAuthorized(msg) {
  return String(msg.chat.id) === String(CHAT_ID);
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ============ Help Command ============

bot.onText(/\/orchestra_help/, (msg) => {
  if (!isAuthorized(msg)) return;

  bot.sendMessage(msg.chat.id, `
<b>MissionChain AI Orchestra v4.0 Commands</b>

<b>Smart Contracts Audit:</b>
/audit_contracts — All 10 Solidity contracts
/audit_contract_tests — Contract test files
/audit_deploy — Deploy scripts

<b>App Audit:</b>
/audit_api — Fastify backend API
/audit_web — Next.js DApp frontend (missionchain.io)
/audit_info — Public site (missionchain.info)
/audit_world — Community platform (missionchain.world)

<b>Infrastructure:</b>
/audit_sdk — Shared TypeScript SDK
/audit_db — Prisma database schema
/audit_orchestra — Self-audit Orchestra code
/audit_full — Full audit (contracts + API + web)
/audit_file &lt;path&gt; — Audit specific file

<b>Reports:</b>
/last_report — Last audit report
/reports — List all reports

<b>Cost:</b>
/cost — Cost tracking summary
/budget — Budget status

<b>Scheduler:</b>
/scheduler_start — Start auto-schedule
/scheduler_stop — Stop schedule
/scheduler_status — Schedule info

<b>Status:</b>
/orchestra_status — System status
`, { parse_mode: "HTML" });
});

// ============ Audit Commands ============

async function runAuditCommand(msg, phase, label) {
  if (!isAuthorized(msg)) return;
  if (!orchestra) {
    bot.sendMessage(msg.chat.id, "Orchestra not initialized — check API keys in .env");
    return;
  }
  if (isAuditing) {
    bot.sendMessage(msg.chat.id, "An audit is already in progress. Please wait.");
    return;
  }

  // Budget check
  const budget = orchestra.costTracker.canSpend();
  if (!budget.ok) {
    bot.sendMessage(msg.chat.id, `Budget limit reached: ${budget.reason}`);
    return;
  }

  isAuditing = true;
  bot.sendMessage(msg.chat.id, `Starting <b>${label}</b>...\nCodex analyzing -> Claude responding -> Debate if needed`, { parse_mode: "HTML" });

  try {
    const results = await orchestra.auditPhase(phase);
    const report = orchestra.generateReport(results, label);

    const totalFindings = results.reduce((s, r) => s + (r.findings?.length || 0), 0);
    const criticals = results.reduce((s, r) => s + (r.findings?.filter(f => f.severity === "CRITICAL").length || 0), 0);
    const debates = results.reduce((s, r) => s + (r.debates?.length || 0), 0);
    const consensusCount = results.reduce((s, r) => s + (r.debates?.filter(d => d.consensus).length || 0), 0);
    const cost = orchestra.costTracker.summary();

    let summary = `<b>${label} Complete</b>\n\n`;
    summary += `Files: ${results.length}\n`;
    summary += `Findings: ${totalFindings}\n`;
    summary += `Critical: ${criticals}\n`;
    summary += `Debates: ${debates} (${consensusCount} resolved)\n`;
    summary += `Cost: $${cost.today} today\n`;
    summary += `Report: <code>${path.basename(report.path)}</code>`;

    bot.sendMessage(msg.chat.id, summary, { parse_mode: "HTML" });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `Audit failed: ${err.message}`);
  } finally {
    isAuditing = false;
  }
}

// Phase commands — mapped to MissionChain codebase structure
bot.onText(/\/audit_contracts$/, (msg) => runAuditCommand(msg, "contracts", "Smart Contracts Audit (10 Solidity files)"));
bot.onText(/\/audit_contract_tests/, (msg) => runAuditCommand(msg, "contract-tests", "Contract Tests Audit"));
bot.onText(/\/audit_deploy/, (msg) => runAuditCommand(msg, "deploy", "Deploy Scripts Audit"));
bot.onText(/\/audit_sdk/, (msg) => runAuditCommand(msg, "sdk", "Shared SDK Audit"));
bot.onText(/\/audit_db/, (msg) => runAuditCommand(msg, "db", "Database Schema Audit"));
bot.onText(/\/audit_api/, (msg) => runAuditCommand(msg, "api", "Backend API Audit"));
bot.onText(/\/audit_web/, (msg) => runAuditCommand(msg, "web", "DApp Frontend Audit"));
bot.onText(/\/audit_info/, (msg) => runAuditCommand(msg, "info", "Public Site Audit (missionchain.info)"));
bot.onText(/\/audit_world/, (msg) => runAuditCommand(msg, "world", "Community Platform Audit (missionchain.world)"));
bot.onText(/\/audit_orchestra/, (msg) => runAuditCommand(msg, "orchestra", "Orchestra Self-Audit"));
bot.onText(/\/audit_full/, (msg) => runAuditCommand(msg, "full", "Full Production Audit"));

bot.onText(/\/audit_file (.+)/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  if (!orchestra) {
    bot.sendMessage(msg.chat.id, "Orchestra not initialized.");
    return;
  }
  if (isAuditing) {
    bot.sendMessage(msg.chat.id, "Audit in progress. Wait.");
    return;
  }

  const filePath = match[1].trim();
  isAuditing = true;
  bot.sendMessage(msg.chat.id, `Auditing: <code>${escapeHtml(filePath)}</code>`, { parse_mode: "HTML" });

  try {
    const result = await orchestra.auditFile(filePath);
    const report = orchestra.generateReport([result], `File Audit: ${filePath}`);
    const findings = result.findings?.length || 0;
    bot.sendMessage(msg.chat.id,
      `Done. ${findings} finding(s). Report: <code>${path.basename(report.path)}</code>`,
      { parse_mode: "HTML" }
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, `Error: ${err.message}`);
  } finally {
    isAuditing = false;
  }
});

// ============ Report Commands ============

bot.onText(/\/last_report/, (msg) => {
  if (!isAuthorized(msg)) return;

  const reportsDir = path.join(__dirname, "..", "reports");
  if (!fs.existsSync(reportsDir)) {
    bot.sendMessage(msg.chat.id, "No reports yet. Run an audit first.");
    return;
  }

  const files = fs.readdirSync(reportsDir)
    .filter(f => f.startsWith("orchestra-report") && f.endsWith(".md"))
    .sort()
    .reverse();

  if (files.length === 0) {
    bot.sendMessage(msg.chat.id, "No reports yet.");
    return;
  }

  const latest = fs.readFileSync(path.join(reportsDir, files[0]), "utf-8");
  const truncated = latest.length > 3800 ? latest.substring(0, 3800) + "\n\n... (truncated)" : latest;
  bot.sendMessage(msg.chat.id, `<pre>${escapeHtml(truncated)}</pre>`, { parse_mode: "HTML" });
});

bot.onText(/\/reports/, (msg) => {
  if (!isAuthorized(msg)) return;

  const reportsDir = path.join(__dirname, "..", "reports");
  if (!fs.existsSync(reportsDir)) {
    bot.sendMessage(msg.chat.id, "No reports directory.");
    return;
  }

  const files = fs.readdirSync(reportsDir)
    .filter(f => f.startsWith("orchestra-report") && f.endsWith(".md"))
    .sort().reverse().slice(0, 10);

  if (files.length === 0) {
    bot.sendMessage(msg.chat.id, "No reports yet.");
    return;
  }

  let list = "<b>Recent Reports</b>\n\n";
  for (const f of files) {
    const stat = fs.statSync(path.join(reportsDir, f));
    list += `<code>${f}</code> (${Math.round(stat.size / 1024)}KB)\n`;
  }
  bot.sendMessage(msg.chat.id, list, { parse_mode: "HTML" });
});

// ============ Cost Commands ============

bot.onText(/\/cost/, (msg) => {
  if (!isAuthorized(msg)) return;
  const tracker = new CostTracker();
  const s = tracker.summary();

  let text = `<b>Orchestra Cost</b>\n\n`;
  text += `Today:      $${s.today}\n`;
  text += `This Month: $${s.thisMonth}\n`;
  text += `All Time:   $${s.allTime}\n`;
  text += `API Calls:  ${s.totalCalls}\n`;

  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/budget/, (msg) => {
  if (!isAuthorized(msg)) return;
  const tracker = new CostTracker();
  const s = tracker.summary();
  const check = tracker.canSpend();

  let text = `<b>Budget Status</b>\n\n`;
  text += `Daily:   $${s.today} / $${s.dailyBudget} ${check.ok ? "" : "(EXCEEDED)"}\n`;
  text += `Monthly: $${s.thisMonth} / $${s.monthlyBudget}\n`;
  text += `Status:  ${check.ok ? "OK — can run audits" : check.reason}\n`;

  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// ============ Scheduler Commands ============

bot.onText(/\/scheduler_start/, (msg) => {
  if (!isAuthorized(msg)) return;
  scheduler.start();
  bot.sendMessage(msg.chat.id, "Orchestra scheduler started.");
});

bot.onText(/\/scheduler_stop/, (msg) => {
  if (!isAuthorized(msg)) return;
  scheduler.stop();
  bot.sendMessage(msg.chat.id, "Scheduler stopped.");
});

bot.onText(/\/scheduler_status/, (msg) => {
  if (!isAuthorized(msg)) return;
  const status = scheduler.status();
  let text = `<b>Scheduler Status</b>\n\n`;
  text += `Running: ${status.running ? "Yes" : "No"}\n\n`;
  for (const j of status.jobs) {
    text += `${j.name}: <code>${j.cron}</code>\n`;
  }
  if (Object.keys(status.lastRun).length > 0) {
    text += `\n<b>Last runs:</b>\n`;
    for (const [phase, ts] of Object.entries(status.lastRun)) {
      text += `${phase}: ${new Date(ts).toISOString()}\n`;
    }
  }
  if (status.cost) {
    text += `\nCost today: $${status.cost.today}`;
  }
  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// ============ Status ============

bot.onText(/\/orchestra_status/, (msg) => {
  if (!isAuthorized(msg)) return;

  const reportsDir = path.join(__dirname, "..", "reports");
  const reportCount = fs.existsSync(reportsDir)
    ? fs.readdirSync(reportsDir).filter(f => f.endsWith(".md")).length : 0;

  const tracker = new CostTracker();
  const cost = tracker.summary();

  let text = `<b>MissionChain Orchestra v4.0 Status</b>\n\n`;
  text += `Codex:    <code>${process.env.CODEX_MODEL || "o1"}</code>\n`;
  text += `Claude:   <code>${process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514"}</code>\n`;
  text += `Reports:  ${reportCount}\n`;
  text += `Scheduler: ${scheduler.running ? "Running" : "Stopped"}\n`;
  text += `Auditing:  ${isAuditing ? "Yes" : "No"}\n`;
  text += `Cost today: $${cost.today}\n`;
  text += `Initialized: ${orchestra ? "Yes" : "No (check API keys)"}\n\n`;
  text += `<b>Ecosystem:</b>\n`;
  text += `  missionchain.info  — Public site\n`;
  text += `  missionchain.world — Community\n`;
  text += `  missionchain.io    — DApp\n`;
  text += `  admin.missionchain.io — Admin`;

  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

// ============ Graceful Shutdown ============

process.on("SIGINT", () => {
  console.log("\n[Orchestra-TG] Shutting down...");
  bot.stopPolling();
  scheduler.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  bot.stopPolling();
  scheduler.stop();
  process.exit(0);
});
