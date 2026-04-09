/**
 * ============================================================
 *  MissionChain — Admin AI Assistant v1.0
 *  Claude-powered AI assistant for admin operations via Telegram.
 *
 *  Capabilities:
 *    1. DIRECTIVES: Admin commands AI to change UI, content, config
 *    2. REPORTS: Auto-generated and on-demand reports per role
 *    3. AUDIT LOG: Every AI action is logged for accountability
 *    4. RBAC: Each admin only sees/does what their role permits
 *
 *  Architecture:
 *    Admin (Telegram) → PermissionChecker (RBAC gate)
 *                      → DirectiveParser (Claude Haiku — classify command)
 *                      → DirectiveExecutor (generate instructions / execute)
 *                      → AuditLogger (persist to reports/)
 *                      → Admin (Telegram response)
 * ============================================================
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { PermissionChecker, ROLES, PERMISSIONS } = require("./admin-config");
const { MC_KNOWLEDGE } = require("./nlp-commander");

// ============ Constants ============

const DIRECTIVE_TYPES = {
  // UI Directives
  ui_layout:        { label: "Thay đổi layout/giao diện", category: "UI" },
  ui_copy:          { label: "Thay đổi text/copy trên trang", category: "UI" },

  // Content Directives
  content_create:   { label: "Tạo nội dung mới", category: "Content" },
  content_edit:     { label: "Chỉnh sửa nội dung", category: "Content" },
  content_translate:{ label: "Dịch/cập nhật bản dịch", category: "Content" },

  // Config Directives
  config_update:    { label: "Cập nhật cấu hình app", category: "Config" },
  deploy_trigger:   { label: "Deploy lên server", category: "Deploy" },
  contract_params:  { label: "Thay đổi tham số contract", category: "Contract" },

  // Notifications
  notification_send:{ label: "Gửi thông báo", category: "Notification" },

  // User Management
  user_manage:      { label: "Quản lý user/KYC", category: "User" },
};

const REPORT_TYPES = {
  daily_summary: {
    label: "Báo cáo tổng hợp hằng ngày",
    description: "Ecosystem overview — apps, contracts, sales, users, SOPHIA",
  },
  financial_report: {
    label: "Báo cáo tài chính",
    description: "SEED/Pre-Sale sales, treasury balance, emission stats, MICE revenue",
  },
  security_report: {
    label: "Báo cáo bảo mật",
    description: "Latest audit findings, critical vulnerabilities, resolution status",
  },
  user_report: {
    label: "Báo cáo người dùng",
    description: "Signups, KYC queue, wallet connections, active users",
  },
  content_report: {
    label: "Báo cáo nội dung",
    description: "SOPHIA content pipeline, moderation queue, community engagement",
  },
  performance_report: {
    label: "Báo cáo hiệu suất",
    description: "Server health, API response times, uptime, error rates",
  },
};

// ============ Admin AI Assistant ============

class AdminAIAssistant {
  constructor(config = {}) {
    this.apiKey = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    this.model = config.model || process.env.NLP_MODEL || "claude-haiku-4-5-20251001";
    this.directiveModel = config.directiveModel || process.env.ADMIN_DIRECTIVE_MODEL || "claude-sonnet-4-20250514";
    this.baseUrl = config.baseUrl || "https://api.anthropic.com/v1";
    this.permissions = new PermissionChecker();
    this.auditLogDir = path.join(__dirname, "..", "reports", "admin-audit-log");

    // Per-admin conversation context
    this.adminSessions = {}; // chatId -> { history, lastDirective, ... }

    // Ensure audit log directory
    if (!fs.existsSync(this.auditLogDir)) {
      fs.mkdirSync(this.auditLogDir, { recursive: true });
    }
  }

  // ============ Main Entry Point ============

  /**
   * Process an admin message — check permissions, classify, execute.
   * @param {string} chatId - Telegram chat ID
   * @param {string} message - Natural language message
   * @returns {{ allowed: boolean, response: string, directive?: object }}
   */
  async processAdminMessage(chatId, message) {
    const admin = this.permissions.getAdmin(chatId);
    if (!admin) {
      return { allowed: false, response: "Bạn không có quyền admin. Liên hệ SUPER_ADMIN để được cấp quyền." };
    }

    // Initialize session if new
    if (!this.adminSessions[chatId]) {
      this.adminSessions[chatId] = {
        history: [],
        lastDirective: null,
        messageCount: 0,
      };
    }

    const session = this.adminSessions[chatId];
    session.messageCount++;

    // Step 1: Classify the message — is it a directive, report request, or question?
    const classification = await this._classifyMessage(message, admin);

    // Step 2: Check permissions
    if (classification.type === "directive") {
      if (!this.permissions.canIssueDirective(chatId, classification.directive)) {
        this._auditLog(admin, "DENIED", classification.directive, message);
        const rolePerms = PERMISSIONS[admin.role];
        return {
          allowed: false,
          response: `Quyền ${admin.role} (${rolePerms.label}) không được phép thực hiện: ${DIRECTIVE_TYPES[classification.directive]?.label || classification.directive}.\n\nQuyền của bạn: ${rolePerms.directives.map(d => DIRECTIVE_TYPES[d]?.label || d).join(", ")}`,
        };
      }
      return this._executeDirective(admin, classification, message, session);
    }

    if (classification.type === "report") {
      if (!this.permissions.canReceiveReport(chatId, classification.reportType)) {
        this._auditLog(admin, "DENIED", `report:${classification.reportType}`, message);
        return {
          allowed: false,
          response: `Quyền ${admin.role} không được nhận báo cáo loại: ${REPORT_TYPES[classification.reportType]?.label || classification.reportType}.`,
        };
      }
      return this._generateReport(admin, classification.reportType, message, session);
    }

    if (classification.type === "admin_list") {
      return this._listAdmins(admin);
    }

    // Default: treat as regular question/chat — let OpsCommander handle
    return { allowed: true, response: null, passThrough: true };
  }

  // ============ Message Classification ============

  async _classifyMessage(message, admin) {
    const directiveList = Object.entries(DIRECTIVE_TYPES)
      .map(([key, val]) => `- "${key}": ${val.label} (${val.category})`)
      .join("\n");

    const reportList = Object.entries(REPORT_TYPES)
      .map(([key, val]) => `- "${key}": ${val.label}`)
      .join("\n");

    try {
      const response = await this._callClaude(
        this.model,
        `Bạn là parser phân loại tin nhắn admin cho hệ thống MissionChain.
Admin "${admin.name}" có role: ${admin.role}.

Phân loại tin nhắn thành 1 trong 4 loại:

1. "directive" — Admin ra lệnh thay đổi gì đó (UI, nội dung, config, deploy, contract)
   Directive types:
   ${directiveList}

2. "report" — Admin yêu cầu báo cáo
   Report types:
   ${reportList}

3. "admin_list" — Hỏi về danh sách admin, phân quyền

4. "pass_through" — Câu hỏi chung, kiểm tra status, audit... (để OpsCommander xử lý)

Trả về JSON duy nhất:
{"type": "directive|report|admin_list|pass_through", "directive": "directive_type_or_null", "reportType": "report_type_or_null", "summary": "tóm tắt ngắn yêu cầu"}`,
        [{ role: "user", content: message }],
        500
      );

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.error(`[AdminAI] Classification failed: ${err.message}`);
    }

    return { type: "pass_through", directive: null, reportType: null, summary: message };
  }

  // ============ Directive Execution ============

  async _executeDirective(admin, classification, message, session) {
    const directiveType = classification.directive;
    const directiveInfo = DIRECTIVE_TYPES[directiveType] || {};

    // Use Sonnet for directive processing (needs depth for code generation)
    const instructions = await this._callClaude(
      this.directiveModel,
      `Bạn là MissionChain Admin AI Assistant. Admin "${admin.name}" (${admin.role}) đang ra chỉ thị.

${MC_KNOWLEDGE}

Hệ thống MissionChain:
- missionchain.info: SSG Next.js, 8 ngôn ngữ, static HTML + translations
- missionchain.world: SSR Next.js, SOPHIA KOL, Community Challenges
- missionchain.io: CSR Next.js, Web3 DApp (Token, Mining, Staking, Sales)
- admin.missionchain.io: Admin Dashboard, RBAC
- api.missionchain.io: Fastify API, Prisma ORM, PostgreSQL

Loại chỉ thị: ${directiveInfo.label} (${directiveInfo.category})

QUAN TRỌNG:
- Tạo hướng dẫn CHI TIẾT để Claude Code có thể thực hiện
- Nếu thay đổi UI: chỉ rõ file, component, CSS class, text cần thay đổi
- Nếu thay đổi content: chỉ rõ nội dung cũ → mới, ngôn ngữ nào
- Nếu deploy: chỉ rõ các bước, server, docker command
- Nếu contract params: ghi rõ tham số + giá trị + cần Gnosis Safe 3-of-5
- Format: Telegram HTML (<b>, <code>, <i>, <pre>)
- LUÔN ghi cảnh báo nếu thay đổi ảnh hưởng đến production
- Nếu cần review trước khi deploy, nói rõ

Trả lời bằng tiếng Việt.`,
      [
        ...session.history.slice(-6),
        { role: "user", content: `Chỉ thị từ ${admin.name} (${admin.role}):\n\n${message}` },
      ],
      3000
    );

    // Audit log
    this._auditLog(admin, "EXECUTED", directiveType, message, instructions);

    // Update session
    session.lastDirective = {
      type: directiveType,
      message,
      timestamp: new Date().toISOString(),
    };
    session.history.push({ role: "user", content: message });
    session.history.push({ role: "assistant", content: instructions });
    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
    }

    return {
      allowed: true,
      response: `<b>[${directiveInfo.category}] ${directiveInfo.label}</b>\n<i>Admin: ${admin.name} (${admin.role})</i>\n\n${instructions}`,
      directive: {
        type: directiveType,
        admin: admin.name,
        role: admin.role,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // ============ Report Generation ============

  async _generateReport(admin, reportType, message, session) {
    const reportInfo = REPORT_TYPES[reportType] || {};

    const report = await this._callClaude(
      this.model,
      `Bạn là MissionChain Report Generator. Tạo báo cáo cho admin "${admin.name}" (${admin.role}).

${MC_KNOWLEDGE}

Loại báo cáo: ${reportInfo.label}
Mô tả: ${reportInfo.description}

Tạo báo cáo với:
- Tiêu đề rõ ràng + ngày
- Tóm tắt executive (3-5 dòng)
- Số liệu chính (dùng <code> cho số)
- Highlights / issues cần chú ý
- Đề xuất hành động (nếu có)

Format: Telegram HTML.
Nếu không có dữ liệu live, ghi rõ "Cần kết nối API/DB để có số liệu real-time" và hiển thị template với placeholder.

Trả lời bằng tiếng Việt.`,
      [{ role: "user", content: message || `Tạo ${reportInfo.label}` }],
      2500
    );

    this._auditLog(admin, "REPORT", reportType, message);

    return {
      allowed: true,
      response: `<b>📊 ${reportInfo.label}</b>\n<i>Yêu cầu bởi: ${admin.name} (${admin.role})</i>\n<i>${new Date().toISOString().slice(0, 10)}</i>\n\n${report}`,
    };
  }

  // ============ Generate Scheduled Report ============

  /**
   * Generate a scheduled report and return it for sending.
   * Called by scheduler, not by direct admin message.
   */
  async generateScheduledReport(chatId, reportType) {
    const admin = this.permissions.getAdmin(chatId);
    if (!admin) return null;
    if (!this.permissions.canReceiveReport(chatId, reportType)) return null;

    const reportInfo = REPORT_TYPES[reportType] || {};

    const report = await this._callClaude(
      this.model,
      `Bạn là MissionChain Report Generator. Tạo báo cáo tự động hằng ngày.

${MC_KNOWLEDGE.substring(0, 1200)}

Loại: ${reportInfo.label}
Mô tả: ${reportInfo.description}

Tạo báo cáo ngắn gọn, tập trung số liệu chính và điểm cần chú ý.
Format: Telegram HTML. Tiếng Việt.
Nếu chưa có data live, dùng template với [placeholder].`,
      [{ role: "user", content: `Báo cáo tự động: ${reportInfo.label}` }],
      2000
    );

    this._auditLog(admin, "SCHEDULED_REPORT", reportType, "auto");

    return {
      chatId,
      text: `<b>📊 ${reportInfo.label} (Tự động)</b>\n<i>${new Date().toISOString().slice(0, 10)}</i>\n\n${report}`,
    };
  }

  // ============ Admin List ============

  async _listAdmins(admin) {
    const admins = this.permissions.listAdmins();
    let text = `<b>Danh sách Admin MissionChain</b>\n\n`;

    for (const a of admins) {
      const perms = PERMISSIONS[a.role];
      text += `<b>${a.name}</b> — <code>${a.role}</code>\n`;
      text += `  ${perms?.description || ""}\n`;
      text += `  Reports: ${perms?.reports?.length || 0} loại\n`;
      text += `  Directives: ${perms?.directives?.length || 0} loại\n`;
      text += `  Active: ${a.active ? "Yes" : "No"}\n\n`;
    }

    return { allowed: true, response: text };
  }

  // ============ Permission Info ============

  /**
   * Generate a permission summary for a specific admin.
   */
  getPermissionSummary(chatId) {
    const admin = this.permissions.getAdmin(chatId);
    if (!admin) return "Không tìm thấy admin.";

    const perms = PERMISSIONS[admin.role];
    if (!perms) return "Không tìm thấy quyền.";

    let text = `<b>Quyền của bạn: ${perms.label}</b>\n\n`;
    text += `<b>Báo cáo được nhận:</b>\n`;
    for (const r of perms.reports) {
      const info = REPORT_TYPES[r];
      text += `  • ${info?.label || r}\n`;
    }
    text += `\n<b>Chỉ thị được ra:</b>\n`;
    for (const d of perms.directives) {
      const info = DIRECTIVE_TYPES[d];
      text += `  • ${info?.label || d}\n`;
    }
    text += `\n<b>Báo cáo tự động:</b>\n`;
    for (const sr of (perms.scheduleReports || [])) {
      const info = REPORT_TYPES[sr.report];
      text += `  • ${info?.label || sr.report} — <code>${sr.cron}</code>\n`;
    }

    return text;
  }

  // ============ Audit Logger ============

  _auditLog(admin, action, target, message, result = null) {
    const entry = {
      timestamp: new Date().toISOString(),
      admin: admin.name,
      role: admin.role,
      chatId: admin.telegramChatId,
      action,       // EXECUTED, DENIED, REPORT, SCHEDULED_REPORT
      target,       // directive type or report type
      message: message?.substring(0, 500),
      resultPreview: result?.substring(0, 200) || null,
    };

    // Append to daily log file
    const today = new Date().toISOString().slice(0, 10);
    const logFile = path.join(this.auditLogDir, `audit-${today}.jsonl`);

    try {
      fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
    } catch (err) {
      console.error(`[AdminAI] Audit log write failed: ${err.message}`);
    }

    // Console log
    const emoji = action === "DENIED" ? "DENIED" : action === "EXECUTED" ? "EXEC" : "LOG";
    console.log(`[AdminAI] [${emoji}] ${admin.name}(${admin.role}) → ${action}: ${target} — "${message?.substring(0, 80)}"`);
  }

  // ============ Read Audit Logs ============

  /**
   * Read recent audit log entries (SUPER_ADMIN only).
   */
  readAuditLog(days = 3, limit = 50) {
    const entries = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(now - i * 86400000).toISOString().slice(0, 10);
      const logFile = path.join(this.auditLogDir, `audit-${date}.jsonl`);

      if (fs.existsSync(logFile)) {
        const lines = fs.readFileSync(logFile, "utf-8").split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            entries.push(JSON.parse(line));
          } catch (e) { /* skip malformed lines */ }
        }
      }
    }

    // Most recent first, limited
    return entries.reverse().slice(0, limit);
  }

  // ============ Claude API Caller ============

  async _callClaude(model, systemPrompt, messages, maxTokens = 1500) {
    const response = await axios.post(
      `${this.baseUrl}/messages`,
      {
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      },
      {
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    return response.data.content[0].text;
  }
}

// ============ Exports ============

module.exports = { AdminAIAssistant, DIRECTIVE_TYPES, REPORT_TYPES };
