/**
 * ============================================================
 *  MissionChain — OpsCommander v4.0
 *  Unified Telegram bot with:
 *    - Natural language interface (Vietnamese/English)
 *    - Multi-admin RBAC (role-based access control)
 *    - AI Admin Assistant (directives, reports, audit log)
 *
 *  Architecture:
 *    Admin (Telegram) → PermissionChecker (who is this?)
 *                      → AdminAIAssistant (directive/report?)
 *                      → NLPCommander (intent parsing)
 *                      → Action Router (execute)
 *                      → NLPCommander (format response)
 *                      → Admin (Telegram)
 *
 *  Each admin gets role-based access:
 *    SUPER_ADMIN    → Everything
 *    FINANCE_ADMIN  → Sales, treasury, emission reports
 *    CONTENT_ADMIN  → SOPHIA, moderation, translations
 *    MODERATOR      → Content review, user flags
 *    KYC_REVIEWER   → KYC queue, user verification
 * ============================================================
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), override: true });
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { NLPCommander } = require("./nlp-commander");
const { Orchestra, CostTracker } = require("./orchestra");
const { OrchestraScheduler } = require("./scheduler");
const { AdminAIAssistant } = require("./admin-ai-assistant");
const { PermissionChecker, ROLES, PERMISSIONS } = require("./admin-config");

// ============ Config ============

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!BOT_TOKEN) {
  console.error("[OpsCommander] TELEGRAM_BOT_TOKEN required");
  process.exit(1);
}

if (!ANTHROPIC_API_KEY) {
  console.error("[OpsCommander] ANTHROPIC_API_KEY required for natural language processing");
  process.exit(1);
}

// ============ Initialize ============

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const permChecker = new PermissionChecker();
const adminAI = new AdminAIAssistant({
  anthropicApiKey: ANTHROPIC_API_KEY,
  model: process.env.NLP_MODEL || "claude-haiku-4-5-20251001",
  directiveModel: process.env.ADMIN_DIRECTIVE_MODEL || process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
});

// Per-admin NLP sessions (each admin gets their own conversation context)
const nlpSessions = {};

function getNLP(chatId) {
  if (!nlpSessions[chatId]) {
    nlpSessions[chatId] = new NLPCommander({
      anthropicApiKey: ANTHROPIC_API_KEY,
      model: process.env.NLP_MODEL || "claude-haiku-4-5-20251001",
      analysisModel: process.env.NLP_ANALYSIS_MODEL || process.env.NLP_MODEL || "claude-haiku-4-5-20251001",
    });
  }
  return nlpSessions[chatId];
}

let orchestra;
try {
  orchestra = new Orchestra();
} catch (err) {
  console.error(`[OpsCommander] Orchestra init warning: ${err.message}`);
  orchestra = null;
}

const scheduler = new OrchestraScheduler();
let isAuditing = false;

console.log("============================================");
console.log("  MissionChain OpsCommander v4.0");
console.log("  Multi-Admin RBAC + AI Assistant");
console.log("  Chat naturally in Vietnamese or English");
console.log("============================================\n");

// ============ Auth (Multi-Admin RBAC) ============

function isAuthorized(msg) {
  return permChecker.isAdmin(msg.chat.id);
}

function getAdminInfo(msg) {
  return permChecker.getAdmin(msg.chat.id);
}

// ============ Action Handlers ============

const actionHandlers = {

  // --- System Status ---
  async status() {
    const cost = new CostTracker().summary();
    const schedStatus = scheduler.status();
    const adminCount = permChecker.listAdmins().length;

    // Workspace readiness — which phases actually have files?
    let readinessBlock = "";
    if (orchestra && typeof orchestra.checkReadiness === "function") {
      const readiness = orchestra.checkReadiness();
      const ready = readiness.phases.filter(p => p.status === "ready").map(p => p.phase);
      const missing = readiness.phases.filter(p => p.status === "no_files").map(p => p.phase);
      readinessBlock = `\nAudit Readiness:
  Ready (${ready.length}): ${ready.join(", ") || "none"}
  Not deployed yet (${missing.length}): ${missing.join(", ") || "none"}`;
    }

    return `MissionChain Ecosystem Status:
Apps:
  missionchain.info  — Public site (SSG)
  missionchain.world — Community (SSR)
  missionchain.io    — DApp (CSR)
  admin.missionchain.io — Admin Dashboard
  api.missionchain.io — Backend API

Orchestra: ${orchestra ? "Ready" : "Not initialized"}
Scheduler: ${schedStatus.running ? "Running" : "Stopped"}
Admins: ${adminCount} registered
Cost today: $${cost.today} / $${cost.dailyBudget}
Cost month: $${cost.thisMonth} / $${cost.monthlyBudget}${readinessBlock}`;
  },

  async deploy_status() {
    return `Server 1 (187.77.149.158) Deploy Status:
Services:
  mc-info  (:3001) — curl http://localhost:3001/health
  mc-world (:3002) — curl http://localhost:3002/health
  mc-admin (:3003) — curl http://localhost:3003/health
  api      (:4000) — curl http://localhost:4000/health
  postgres (:5432) — Internal
  redis    (:6379) — Internal

Domains: missionchain.info, .world, .io, admin.missionchain.io`;
  },

  // --- Smart Contract Operations ---
  async contract_status() {
    return `Smart Contracts (10 on BSC):
  1. MICToken (BEP-20) — 7B cap, 15% pre-issued
  2. VestingManager — 6 vesting schedules
  3. SeedSale — $0.0025/MIC, NO bonus, KYC whitelist, bundled MFP-NFT
  4. ReferralRegistry — F1: 5%, F2: 2% USDT
  5. PreSale — $0.005/MIC, +10% bonus
  6. AirdropDistributor — Merkle proof claims
  7. MICELicense (ERC-1155) — 100K max, dynamic $300-$1000
  8. EmissionController — E(t) = E_base x D(t) x R(t)
  9. MiningPool — Hindex-weighted
  10. NFTStaking — 5-tier x time-lock
Admin: Gnosis Safe 3-of-5 multisig`;
  },

  async emission_check() {
    return `Adaptive Emission Engine:
E(t) = E_base(t) x D(t) x R(t)
  E0 = 22,907,500 MIC/day, T_half = 180 days
Mining Pool 85% = 5,950,000,000 MIC:
  Miners 60% / NFT Staking 20% / DAO 15% / Buyback 5%
Circuit Breakers: cap 5.95B, daily 2x, floor $0.001, unstake 10%/day`;
  },

  async seed_status() {
    return `SEED Round: 3.25% = 227.5M MIC @ $0.0025 (NO bonus)
NO referral. Vesting: 10% after 6mo, 2.5%/mo
Packages (+ bundled MFP-NFT):
  EARLY BIRD $1K → 400K MIC + 20 MFP-NFT
  FOUNDING PARTNER I $2.5K → 1M MIC + 60 MFP-NFT
  FOUNDING PARTNER II $5K → 2M MIC + 150 MFP-NFT
  FOUNDING PARTNER III $10K → 4M MIC + 350 MFP-NFT`;
  },

  async presale_status() {
    return `Pre-Sale: 4.50% = 315M MIC @ $0.005 + 10% bonus
Referral: F1:5% F2:2% USDT. Payment: USDT + BNB
Packages: $100→22K / $500→110K / $1K→220K / $5K→1.1M`;
  },

  async staking_status() {
    return `NFT Staking (20% emissions = 1.19B MIC):
MFP-NFT x10 (1M cap) / Platinum x5 (500K) / Gold x2.5 (250K) / Silver x1 (100K) / No-NFT x0.5 (50K)
Time-lock: 30d=1x / 90d=1.25x / 180d=1.5x / 360d=2x`;
  },

  async mice_status() {
    return `MICE License: ERC-1155, 360 days, max 100K
Price: P(t) = $300 + $700 x (active/100K)
Revenue: 50% Treasury / 30% Liquidity / 20% Buyback`;
  },

  async sophia_status() {
    return `SOPHIA AI KOL — missionchain.world
Features: SOPHIA WORD (devotionals), Content Creation, Challenges
Role: Public-facing Christian AI mentor & content creator`;
  },

  async moderation() {
    return `Content Moderation — admin.missionchain.io
Roles: CONTENT_ADMIN, MODERATOR
Pipeline: Content review → ModerationFlag → Action`;
  },

  async user_stats() {
    return `Users: Shared PostgreSQL across all apps
Tables: User, Wallet, Session, Notification
KYC: Sumsub + on-chain allowlist
RBAC: SUPER_ADMIN, FINANCE_ADMIN, CONTENT_ADMIN, MODERATOR, KYC_REVIEWER`;
  },

  // --- Orchestra / Audit ---
  async audit(target) {
    if (!orchestra) return "Orchestra chưa khởi tạo — kiểm tra API keys.";
    if (isAuditing) return "Đang có audit đang chạy. Vui lòng đợi.";

    const budget = orchestra.costTracker.canSpend();
    if (!budget.ok) return `Budget limit: ${budget.reason}`;

    const phase = target || "full";
    const validPhases = ["contracts", "contract-tests", "deploy", "sdk", "db", "api", "web", "info", "world", "orchestra", "full"];
    if (!validPhases.includes(phase)) {
      return `Phase không hợp lệ: ${phase}. Chọn: ${validPhases.join(", ")}`;
    }

    // Readiness check — warn if phase has no files in workspace
    if (typeof orchestra.checkReadiness === "function") {
      const readiness = orchestra.checkReadiness();
      const phaseInfo = readiness.phases.find(p => p.phase === phase);
      if (phaseInfo && phaseInfo.status === "no_files") {
        const ready = readiness.phases.filter(p => p.status === "ready").map(p => p.phase);
        return `Phase "${phase}" chưa có file trong workspace (0/${phaseInfo.total} files).\n` +
          `Codebase chưa deploy cho phase này.\n\n` +
          `Phase sẵn sàng: ${ready.join(", ") || "none"}\n` +
          `Dùng: audit info / audit orchestra`;
      }
    }

    isAuditing = true;
    runAuditAsync(phase);
    return `Đang chạy audit "${phase}"... Codex → Claude → Debate. Sẽ báo khi xong.`;
  },

  async last_report() {
    const reportsDir = path.join(__dirname, "..", "reports");
    if (!fs.existsSync(reportsDir)) return "Chưa có báo cáo. Chạy audit trước.";
    const files = fs.readdirSync(reportsDir)
      .filter(f => f.startsWith("orchestra-report") && f.endsWith(".md"))
      .sort().reverse();
    if (files.length === 0) return "Chưa có báo cáo.";
    const content = fs.readFileSync(path.join(reportsDir, files[0]), "utf-8");
    return content.length > 3000 ? content.substring(0, 3000) + "\n\n... (cắt bớt)" : content;
  },

  async list_reports() {
    const reportsDir = path.join(__dirname, "..", "reports");
    if (!fs.existsSync(reportsDir)) return "Chưa có reports.";
    const files = fs.readdirSync(reportsDir)
      .filter(f => f.startsWith("orchestra-report") && f.endsWith(".md"))
      .sort().reverse().slice(0, 10);
    if (files.length === 0) return "Chưa có báo cáo.";
    return "Báo cáo gần nhất:\n" + files.map(f => {
      const stat = fs.statSync(path.join(reportsDir, f));
      return `- ${f} (${Math.round(stat.size / 1024)}KB)`;
    }).join("\n");
  },

  // --- Cost & Budget ---
  async cost_report() {
    const s = new CostTracker().summary();
    return `Chi phí Orchestra:
Hôm nay: $${s.today} / Tháng: $${s.thisMonth} / Tổng: $${s.allTime}
API calls: ${s.totalCalls} / Budget: $${s.dailyBudget}/ngày, $${s.monthlyBudget}/tháng`;
  },

  async budget_status() {
    const tracker = new CostTracker();
    const s = tracker.summary();
    const check = tracker.canSpend();
    return `Budget: $${s.today}/$${s.dailyBudget} (ngày) | $${s.thisMonth}/$${s.monthlyBudget} (tháng)
Status: ${check.ok ? "OK — có thể chạy audit" : check.reason}`;
  },

  // --- Scheduler ---
  async scheduler_start() {
    scheduler.start();
    return "Scheduler đã bật. Audit tự động theo lịch.";
  },

  async scheduler_stop() {
    scheduler.stop();
    return "Scheduler đã tắt.";
  },

  async scheduler_status() {
    const status = scheduler.status();
    let text = `Scheduler: ${status.running ? "Đang chạy" : "Đã tắt"}\n`;
    for (const j of status.jobs) text += `- ${j.name}: ${j.cron}\n`;
    if (Object.keys(status.lastRun).length > 0) {
      text += "Lần chạy gần nhất:\n";
      for (const [phase, ts] of Object.entries(status.lastRun)) {
        text += `- ${phase}: ${new Date(ts).toISOString()}\n`;
      }
    }
    return text;
  },

  // --- Emergency ---
  async emergency_pause() {
    return `EMERGENCY PAUSE — Cần Gnosis Safe 3-of-5 multisig:
1. Truy cập admin.missionchain.io
2. Kết nối wallet (cần 3/5 signers)
3. Chọn Emergency Pause → Xác nhận giao dịch`;
  },

  // --- Session ---
  async session_stats(chatId) {
    const nlp = getNLP(chatId);
    const stats = nlp.getStats();
    const cost = new CostTracker().summary();
    const admin = permChecker.getAdmin(chatId);
    return `Session: ${admin?.name || "Unknown"} (${admin?.role || "?"})
Messages: ${stats.messageCount} | Language: ${stats.detectedLanguage}
NLP: ${stats.model} | Analysis: ${stats.analysisModel}
Cost today: $${cost.today}`;
  },

  // --- Admin AI Commands ---
  async admin_report(chatId) {
    return adminAI.getPermissionSummary(chatId);
  },

  async admin_list() {
    const result = await adminAI._listAdmins({ name: "system" });
    return result.response;
  },

  async admin_audit_log() {
    const entries = adminAI.readAuditLog(3, 20);
    if (entries.length === 0) return "Chưa có audit log.";
    let text = "<b>Admin Audit Log (3 ngày gần nhất)</b>\n\n";
    for (const e of entries) {
      text += `<code>${e.timestamp.slice(0, 16)}</code> ${e.admin}(${e.role}) ${e.action}: ${e.target}\n`;
    }
    return text;
  },

  // --- File / Directory Browsing ---
  async browse_directory(target) {
    const safeBases = [
      "/opt/missionchain",
      "/home/deploy",
      path.join(__dirname, ".."),
    ];

    const dir = target || "/opt/missionchain";
    const resolved = path.resolve(dir);

    // Security: only allow browsing safe directories
    const allowed = safeBases.some(b => resolved.startsWith(b));
    if (!allowed) {
      return `⛔ Access denied: "${resolved}"\nAllowed directories:\n${safeBases.map(b => `  • ${b}`).join("\n")}`;
    }

    if (!fs.existsSync(resolved)) {
      return `Directory not found: ${resolved}`;
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      // It's a file — show info + first 50 lines
      const size = stat.size;
      const ext = path.extname(resolved);
      const isBinary = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".zip", ".tar", ".gz", ".pdf"].includes(ext);
      let text = `📄 <b>File:</b> ${resolved}\nSize: ${(size / 1024).toFixed(1)} KB | Modified: ${stat.mtime.toISOString().slice(0, 16)}`;
      if (!isBinary && size < 100000) {
        const content = fs.readFileSync(resolved, "utf-8");
        const lines = content.split("\n").slice(0, 50);
        text += `\n\n<pre>${lines.join("\n").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
        if (content.split("\n").length > 50) text += `\n... (${content.split("\n").length} total lines)`;
      } else if (isBinary) {
        text += "\n(Binary file — cannot display)";
      }
      return text;
    }

    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => `📁 ${e.name}/`).sort();
      const files = entries.filter(e => e.isFile()).map(e => {
        const s = fs.statSync(path.join(resolved, e.name));
        return `📄 ${e.name} (${(s.size / 1024).toFixed(1)}KB)`;
      }).sort();

      let text = `📂 <b>${resolved}</b>\n${dirs.length} folders, ${files.length} files\n\n`;
      if (dirs.length > 0) text += dirs.join("\n") + "\n";
      if (files.length > 0) text += files.join("\n");

      if (dirs.length === 0 && files.length === 0) text += "(empty directory)";

      // Truncate if too long
      if (text.length > 3500) {
        text = text.substring(0, 3500) + `\n\n... (truncated, ${entries.length} total entries)`;
      }

      return text;
    } catch (err) {
      return `Error reading directory: ${err.message}`;
    }
  },

  async read_file(target) {
    if (!target) return "Please specify a file path.";
    const resolved = path.resolve(target);
    const safeBases = ["/opt/missionchain", "/home/deploy", path.join(__dirname, "..")];
    const allowed = safeBases.some(b => resolved.startsWith(b));
    if (!allowed) return `⛔ Access denied: "${resolved}"`;
    if (!fs.existsSync(resolved)) return `File not found: ${resolved}`;
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return `"${resolved}" is a directory. Use browse_directory instead.`;
    if (stat.size > 200000) return `File too large (${(stat.size / 1024).toFixed(1)}KB). Max 200KB.`;
    const content = fs.readFileSync(resolved, "utf-8");
    const lines = content.split("\n");
    const display = lines.slice(0, 100).join("\n").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let text = `📄 <b>${resolved}</b> (${lines.length} lines, ${(stat.size / 1024).toFixed(1)}KB)\n\n<pre>${display}</pre>`;
    if (lines.length > 100) text += `\n\n... (showing 100/${lines.length} lines)`;
    return text;
  },

  // --- Help ---
  async help(chatId) {
    const admin = permChecker.getAdmin(chatId);
    const perms = admin ? PERMISSIONS[admin.role] : null;

    let text = `<b>MissionChain OpsCommander v4.0</b>
<i>${admin ? `${admin.name} — ${admin.role}` : "Guest"}</i>\n
<b>Hỏi tự nhiên bằng tiếng Việt:</b>
  "Tình hình thế nào?" → tổng quan
  "Kiểm tra smart contract" → audit
  "Emission engine?" → emission status
  "Phân tích tokenomics" → AI analysis\n`;

    if (perms && perms.directives.length > 0) {
      text += `<b>Chỉ thị Admin AI (quyền ${admin.role}):</b>\n`;
      if (perms.directives.includes("ui_layout") || perms.directives.includes("ui_copy"))
        text += `  "Đổi tiêu đề trang chủ thành..." → thay đổi UI\n`;
      if (perms.directives.includes("content_create"))
        text += `  "Viết bài SOPHIA về..." → tạo nội dung\n`;
      if (perms.directives.includes("content_translate"))
        text += `  "Dịch trang SEED sang tiếng Hàn" → dịch thuật\n`;
      if (perms.directives.includes("deploy_trigger"))
        text += `  "Deploy lên server" → trigger deploy\n`;
      if (perms.directives.includes("contract_params"))
        text += `  "Thay đổi MICE price range" → contract params\n`;
      if (perms.directives.includes("notification_send"))
        text += `  "Thông báo cho users về..." → gửi notification\n`;
    }

    text += `\n<b>Báo cáo:</b>\n`;
    text += `  "Báo cáo tài chính" / "Báo cáo bảo mật" / "Báo cáo users"\n`;
    text += `\n<b>📁 File & Directory:</b>\n`;
    text += `  Send documents/photos → auto-saved to server\n`;
    text += `  "List files in /opt/missionchain" → browse directory\n`;
    text += `  "Show file /opt/missionchain/readme.md" → read file\n`;

    text += `\n<b>Commands:</b>\n`;
    text += `  /help — This help\n`;
    text += `  /stats — Session stats\n`;
    text += `  /clear — Clear conversation history\n`;
    text += `  /mypermissions — View your permissions\n`;
    text += `  /admins — List admins\n`;
    text += `  /auditlog — Admin audit log (SUPER_ADMIN)\n`;

    return text;
  },
};

// ============ Async Audit Runner ============

async function runAuditAsync(phase) {
  try {
    const results = await orchestra.auditPhase(phase);
    const report = orchestra.generateReport(results, `Audit: ${phase}`);
    const totalFindings = results.reduce((s, r) => s + (r.findings?.length || 0), 0);
    const criticals = results.reduce((s, r) =>
      s + (r.findings?.filter(f => f.severity === "CRITICAL").length || 0), 0);
    const cost = orchestra.costTracker.summary();

    const rawResult = `Audit "${phase}" hoàn thành:
Files: ${results.length} | Findings: ${totalFindings} | Critical: ${criticals}
Cost: $${cost.today} | Report: ${path.basename(report.path)}`;

    // Notify all admins who can receive security reports
    const recipients = permChecker.getReportRecipients("security_report");
    for (const { chatId } of recipients) {
      const nlp = getNLP(chatId);
      const response = await nlp.generateResponse(`Kết quả audit ${phase}`, rawResult);
      await sendMessageTo(chatId, response);
    }

    // Fallback: if no recipients found, send to primary
    if (recipients.length === 0 && process.env.TELEGRAM_CHAT_ID) {
      const nlp = getNLP(process.env.TELEGRAM_CHAT_ID);
      const response = await nlp.generateResponse(`Kết quả audit ${phase}`, rawResult);
      await sendMessageTo(process.env.TELEGRAM_CHAT_ID, response);
    }
  } catch (err) {
    // Notify primary admin
    if (process.env.TELEGRAM_CHAT_ID) {
      await sendMessageTo(process.env.TELEGRAM_CHAT_ID, `Audit failed: ${err.message}`);
    }
  } finally {
    isAuditing = false;
  }
}

// ============ Message Sender ============

async function sendMessageTo(chatId, text) {
  try {
    if (text.length > 4000) {
      const parts = splitMessage(text, 4000);
      for (const part of parts) {
        await bot.sendMessage(chatId, part, { parse_mode: "HTML" });
      }
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: "HTML" });
    }
  } catch (err) {
    try {
      await bot.sendMessage(chatId, text.replace(/<[^>]*>/g, ""));
    } catch (e) {
      console.error(`[OpsCommander] Send to ${chatId} failed: ${e.message}`);
    }
  }
}

function splitMessage(text, maxLen) {
  const parts = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > maxLen) {
      parts.push(current);
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// ============ Document / File Handler ============

const UPLOAD_DIR = path.join(__dirname, "..", "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log(`[OpsCommander] Created upload directory: ${UPLOAD_DIR}`);
}

bot.on("document", async (msg) => {
  const chatId = String(msg.chat.id);
  if (!isAuthorized(msg)) return;

  const admin = getAdminInfo(msg);
  const doc = msg.document;
  console.log(`[OpsCommander] [${admin.name}] Document received: ${doc.file_name} (${(doc.file_size / 1024).toFixed(1)}KB)`);

  try {
    bot.sendChatAction(parseInt(chatId), "typing");

    // Size limit: 20MB
    if (doc.file_size > 20 * 1024 * 1024) {
      await sendMessageTo(chatId, `⚠️ File too large (${(doc.file_size / 1024 / 1024).toFixed(1)}MB). Max: 20MB.`);
      return;
    }

    // Download file
    const fileLink = await bot.getFileLink(doc.file_id);
    const response = await fetch(fileLink);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Save with timestamp prefix to avoid conflicts
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safeName = doc.file_name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${timestamp}_${safeName}`;
    const filePath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(filePath, buffer);

    const ext = path.extname(doc.file_name).toLowerCase();
    const isText = [".txt", ".md", ".json", ".js", ".ts", ".py", ".html", ".css", ".yml", ".yaml", ".env", ".sh", ".sql", ".csv", ".log", ".xml", ".toml"].includes(ext);

    let preview = "";
    if (isText && doc.file_size < 50000) {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n").slice(0, 20);
      preview = `\n\n<b>Preview (first 20 lines):</b>\n<pre>${lines.join("\n").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
      if (content.split("\n").length > 20) preview += `\n... (${content.split("\n").length} total lines)`;
    }

    const caption = msg.caption ? `\nCaption: "${msg.caption}"` : "";

    await sendMessageTo(chatId,
      `✅ <b>File received and saved</b>\n\n` +
      `📄 <b>Name:</b> ${doc.file_name}\n` +
      `📦 <b>Size:</b> ${(doc.file_size / 1024).toFixed(1)} KB\n` +
      `📁 <b>Saved to:</b> <code>${filePath}</code>${caption}${preview}`
    );

    // If there's a caption, process it as a directive about this file
    if (msg.caption) {
      await processMessage(chatId, admin, `Received file "${doc.file_name}" at ${filePath}. User says: ${msg.caption}`);
    }

  } catch (err) {
    console.error(`[OpsCommander] Document handler error: ${err.message}`);
    await sendMessageTo(chatId, `❌ Failed to save file: ${err.message}`);
  }
});

// ============ Photo Handler ============

bot.on("photo", async (msg) => {
  const chatId = String(msg.chat.id);
  if (!isAuthorized(msg)) return;

  const admin = getAdminInfo(msg);
  const photo = msg.photo[msg.photo.length - 1]; // highest resolution

  try {
    bot.sendChatAction(parseInt(chatId), "typing");

    const fileLink = await bot.getFileLink(photo.file_id);
    const response = await fetch(fileLink);
    const buffer = Buffer.from(await response.arrayBuffer());

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `${timestamp}_photo.jpg`;
    const filePath = path.join(UPLOAD_DIR, filename);

    fs.writeFileSync(filePath, buffer);

    const caption = msg.caption ? `\nCaption: "${msg.caption}"` : "";

    await sendMessageTo(chatId,
      `✅ <b>Photo received and saved</b>\n\n` +
      `📸 <b>Size:</b> ${photo.width}x${photo.height} (${(buffer.length / 1024).toFixed(1)} KB)\n` +
      `📁 <b>Saved to:</b> <code>${filePath}</code>${caption}`
    );

    if (msg.caption) {
      await processMessage(chatId, admin, `Received photo at ${filePath}. User says: ${msg.caption}`);
    }

  } catch (err) {
    console.error(`[OpsCommander] Photo handler error: ${err.message}`);
    await sendMessageTo(chatId, `❌ Failed to save photo: ${err.message}`);
  }
});

// ============ Main Message Handler ============

bot.on("message", async (msg) => {
  // Skip non-text messages (handled by document/photo handlers above)
  if (!msg.text) return;
  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  // Check authorization
  if (!isAuthorized(msg)) {
    // Silently ignore non-admin messages (or respond with denial)
    if (text === "/help" || text === "/start") {
      await sendMessageTo(chatId, "Bạn không có quyền admin MissionChain. Liên hệ SUPER_ADMIN.");
    }
    return;
  }

  const admin = getAdminInfo(msg);
  console.log(`[OpsCommander] [${admin.name}/${admin.role}] "${text}"`);

  // ---- Special slash commands ----

  if (text === "/clear") {
    const nlp = getNLP(chatId);
    nlp.clearHistory();
    await sendMessageTo(chatId, "Đã xóa lịch sử hội thoại. Session mới.");
    return;
  }

  if (text === "/stats") {
    const result = await actionHandlers.session_stats(chatId);
    await sendMessageTo(chatId, result);
    return;
  }

  if (text === "/mypermissions") {
    const result = adminAI.getPermissionSummary(chatId);
    await sendMessageTo(chatId, result);
    return;
  }

  if (text === "/admins") {
    if (!permChecker.canExecuteAction(chatId, "admin_list")) {
      await sendMessageTo(chatId, `Quyền ${admin.role} không được xem danh sách admin.`);
      return;
    }
    const result = await actionHandlers.admin_list();
    await sendMessageTo(chatId, result);
    return;
  }

  if (text === "/auditlog") {
    if (admin.role !== ROLES.SUPER_ADMIN) {
      await sendMessageTo(chatId, "Chỉ SUPER_ADMIN mới xem được audit log.");
      return;
    }
    const result = await actionHandlers.admin_audit_log();
    await sendMessageTo(chatId, result);
    return;
  }

  // ---- Process as natural language ----

  // Legacy slash → convert to natural language
  if (text.startsWith("/") && !text.startsWith("/help")) {
    const cleaned = text.replace(/^\//, "").replace(/_/g, " ");
    await processMessage(chatId, admin, cleaned);
    return;
  }

  await processMessage(chatId, admin, text);
});

async function processMessage(chatId, admin, text) {
  try {
    bot.sendChatAction(parseInt(chatId), "typing");

    // ---- Step 1: Try Admin AI Assistant first (directives, reports, admin queries) ----
    const aiResult = await adminAI.processAdminMessage(chatId, text);

    if (!aiResult.passThrough) {
      // Admin AI handled it (directive, report, admin query)
      if (aiResult.response) {
        await sendMessageTo(chatId, aiResult.response);
      }
      return;
    }

    // ---- Step 2: Regular OpsCommander flow (status, audit, chat...) ----
    const nlp = getNLP(chatId);

    // Parse intent
    const intent = await nlp.parse(text);
    console.log(`[OpsCommander] [${admin.name}] "${text}" → ${intent.action}:${intent.target}`);

    // Check action permission
    if (!permChecker.canExecuteAction(chatId, intent.action)) {
      const rolePerms = PERMISSIONS[admin.role];
      await sendMessageTo(chatId,
        `Quyền <b>${admin.role}</b> (${rolePerms?.label}) không được thực hiện: <code>${intent.action}</code>`,
      );
      return;
    }

    // Deep analysis
    if (intent.action === "analyze") {
      const response = await nlp.analyze(text);
      await sendMessageTo(chatId, response);
      return;
    }

    // General chat
    if (intent.action === "chat") {
      const response = await nlp.chat(text);
      await sendMessageTo(chatId, response);
      return;
    }

    // Execute action handler
    const handler = actionHandlers[intent.action];
    if (!handler) {
      const response = await nlp.chat(text);
      await sendMessageTo(chatId, response);
      return;
    }

    // Some handlers need chatId for personalization
    const needsChatId = ["help", "session_stats", "admin_report"];
    const rawResult = needsChatId.includes(intent.action)
      ? await handler(chatId)
      : await handler(intent.target, intent.params);

    // Simple actions: send raw
    const simpleActions = ["help", "emergency_pause", "scheduler_start", "scheduler_stop"];
    if (simpleActions.includes(intent.action)) {
      await sendMessageTo(chatId, rawResult);
    } else {
      // Use NLP to format response conversationally
      const response = await nlp.generateResponse(text, rawResult);
      await sendMessageTo(chatId, response);
    }

  } catch (err) {
    console.error(`[OpsCommander] [${admin.name}] Error: ${err.message}`);
    await sendMessageTo(chatId, `Xin lỗi, có lỗi xảy ra: ${err.message}`);
  }
}

// ============ Scheduled Report Delivery ============

const reportJobs = [];

function startScheduledReports() {
  const scheduledReports = permChecker.getAllScheduledReports();

  for (const sr of scheduledReports) {
    if (!cron.validate(sr.cron)) continue;

    const job = cron.schedule(sr.cron, async () => {
      console.log(`[ScheduledReport] Sending ${sr.report} to ${sr.adminName} (${sr.role})`);
      try {
        const result = await adminAI.generateScheduledReport(sr.chatId, sr.report);
        if (result) {
          await sendMessageTo(result.chatId, result.text);
        }
      } catch (err) {
        console.error(`[ScheduledReport] Failed for ${sr.adminName}: ${err.message}`);
      }
    });

    reportJobs.push(job);
    console.log(`[ScheduledReport] ${sr.adminName} ← ${sr.report} @ ${sr.cron}`);
  }

  if (reportJobs.length > 0) {
    console.log(`[ScheduledReport] ${reportJobs.length} scheduled report(s) active.\n`);
  }
}

// ============ Startup ============

(async () => {
  try {
    // Notify all admins that bot is online
    const admins = permChecker.listAdmins();
    for (const admin of admins) {
      const chatId = permChecker.getAdmin(
        Object.entries(permChecker.admins || {}).find(([_, a]) => a.name === admin.name)?.[0]
      )?.telegramChatId;

      // Only notify SUPER_ADMIN on startup
      if (admin.role === ROLES.SUPER_ADMIN && chatId) {
        await sendMessageTo(chatId,
          `<b>MissionChain OpsCommander v4.0 Online</b>\n\n` +
          `Admin: ${admins.length} registered\n` +
          `Role: ${admin.role}\n` +
          `Chat tự nhiên bằng tiếng Việt. Gõ /help để xem hướng dẫn.\n\n` +
          `<i>Ecosystem: missionchain.info | .world | .io</i>`,
          );
      }
    }

    // Start scheduled reports
    startScheduledReports();

    console.log("[OpsCommander] Startup complete — listening for messages.\n");
  } catch (err) {
    console.error(`[OpsCommander] Startup warning: ${err.message}`);
  }
})();

// ============ Graceful Shutdown ============

process.on("SIGINT", () => {
  console.log("\n[OpsCommander] Shutting down...");
  bot.stopPolling();
  scheduler.stop();
  for (const job of reportJobs) job.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  bot.stopPolling();
  scheduler.stop();
  for (const job of reportJobs) job.stop();
  process.exit(0);
});
