/**
 * ============================================================
 *  MissionChain — Admin RBAC Configuration
 *  Defines admin roles, Telegram chat IDs, and permissions.
 *
 *  Each admin has:
 *    - telegramChatId: unique Telegram identifier
 *    - role: RBAC role determining access level
 *    - name: display name for audit logs
 *    - active: can be disabled without removing
 *
 *  Permissions matrix defines:
 *    - actions: which OpsCommander actions this role can trigger
 *    - reports: which report types this role receives
 *    - directives: what this role can command the AI to change
 *    - scheduleReports: auto-sent reports on schedule
 * ============================================================
 */

// ============ RBAC Roles ============

const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  FINANCE_ADMIN: "FINANCE_ADMIN",
  CONTENT_ADMIN: "CONTENT_ADMIN",
  MODERATOR: "MODERATOR",
  KYC_REVIEWER: "KYC_REVIEWER",
};

// ============ Permissions Matrix ============

const PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: {
    label: "Super Admin",
    description: "Full access — all reports, all commands, all directives",

    // Actions this role can execute via Telegram
    actions: [
      "status", "deploy_status",
      "contract_status", "emission_check", "seed_status", "presale_status",
      "staking_status", "mice_status",
      "sophia_status", "moderation", "user_stats",
      "audit", "last_report", "list_reports",
      "cost_report", "budget_status",
      "scheduler_start", "scheduler_stop", "scheduler_status",
      "emergency_pause",
      "analyze", "chat", "help",
      "session_stats", "clear_history",
      // Admin AI directives
      "directive_ui", "directive_content", "directive_config",
      "directive_deploy", "directive_contract",
      "admin_report", "admin_list",
      "browse_directory", "read_file",
    ],

    // Reports this role can request or receives automatically
    reports: [
      "daily_summary",        // Full ecosystem summary
      "financial_report",     // Sales, treasury, emission
      "security_report",      // Audit findings, vulnerabilities
      "user_report",          // Signups, KYC, wallets
      "content_report",       // SOPHIA, moderation, community
      "performance_report",   // Server health, response times
    ],

    // What this role can command the AI to change
    directives: [
      "ui_layout",            // Change UI components, pages, styling
      "ui_copy",              // Change button labels, headings, descriptions
      "content_create",       // Create new content (SOPHIA posts, announcements)
      "content_edit",         // Edit existing content
      "content_translate",    // Trigger translation pipeline
      "config_update",        // Update app configurations
      "deploy_trigger",       // Trigger deployment
      "contract_params",      // Adjust contract parameters (via Gnosis Safe)
      "notification_send",    // Send notifications to users
      "user_manage",          // KYC actions, role assignments
    ],

    // Auto-scheduled reports (cron + report type)
    scheduleReports: [
      { cron: "0 8 * * *",   report: "daily_summary" },      // 8 AM daily
      { cron: "0 9 * * 1",   report: "financial_report" },   // Monday 9 AM
      { cron: "0 7 * * *",   report: "security_report" },    // 7 AM daily (after audit)
    ],
  },

  [ROLES.FINANCE_ADMIN]: {
    label: "Finance Admin",
    description: "Financial data — sales, treasury, emission, pricing",

    actions: [
      "status",
      "seed_status", "presale_status", "emission_check",
      "staking_status", "mice_status",
      "cost_report", "budget_status",
      "analyze", "chat", "help",
      "admin_report",
      // Limited directives
      "directive_content",
    ],

    reports: [
      "financial_report",
      "daily_summary",        // Summary only (no security details)
    ],

    directives: [
      "content_edit",         // Can edit pricing/sales copy
      "notification_send",    // Send sale-related notifications
    ],

    scheduleReports: [
      { cron: "0 8 * * *",   report: "financial_report" },   // Daily 8 AM
      { cron: "0 9 * * 1",   report: "daily_summary" },      // Monday summary
    ],
  },

  [ROLES.CONTENT_ADMIN]: {
    label: "Content Admin",
    description: "Content management — SOPHIA, translations, announcements",

    actions: [
      "status",
      "sophia_status", "moderation", "user_stats",
      "cost_report",
      "analyze", "chat", "help",
      "admin_report",
      // Content directives
      "directive_content", "directive_ui",
    ],

    reports: [
      "content_report",
      "user_report",
    ],

    directives: [
      "ui_copy",              // Change text/copy on pages
      "content_create",       // Create SOPHIA posts, announcements
      "content_edit",         // Edit existing content
      "content_translate",    // Trigger translations
      "notification_send",    // Send content notifications
    ],

    scheduleReports: [
      { cron: "0 8 * * *",   report: "content_report" },     // Daily content
      { cron: "0 10 * * 1",  report: "user_report" },        // Monday users
    ],
  },

  [ROLES.MODERATOR]: {
    label: "Moderator",
    description: "Community moderation — content review, user flags",

    actions: [
      "status",
      "moderation", "user_stats",
      "sophia_status",
      "chat", "help",
      "admin_report",
    ],

    reports: [
      "content_report",
    ],

    directives: [
      "content_edit",         // Flag/unflag content only
    ],

    scheduleReports: [
      { cron: "0 9 * * *",   report: "content_report" },
    ],
  },

  [ROLES.KYC_REVIEWER]: {
    label: "KYC Reviewer",
    description: "KYC verification — user identity review, whitelist management",

    actions: [
      "status",
      "user_stats",
      "chat", "help",
      "admin_report",
    ],

    reports: [
      "user_report",
    ],

    directives: [
      "user_manage",          // KYC approve/reject only
    ],

    scheduleReports: [
      { cron: "0 9 * * *",   report: "user_report" },
    ],
  },
};

// ============ Admin Registry ============
// Load from .env: ADMIN_USERS=chatId1:role1:name1,chatId2:role2:name2,...

function loadAdmins() {
  const admins = {};

  // Primary admin (backward compatible — TELEGRAM_CHAT_ID = SUPER_ADMIN)
  const primaryChatId = process.env.TELEGRAM_CHAT_ID;
  if (primaryChatId) {
    admins[primaryChatId] = {
      telegramChatId: primaryChatId,
      role: ROLES.SUPER_ADMIN,
      name: process.env.ADMIN_PRIMARY_NAME || "Primary Admin",
      active: true,
    };
  }

  // Additional admins from ADMIN_USERS env var
  const adminUsersEnv = process.env.ADMIN_USERS || "";
  if (adminUsersEnv.trim()) {
    const entries = adminUsersEnv.split(",").map(e => e.trim()).filter(Boolean);
    for (const entry of entries) {
      const [chatId, role, ...nameParts] = entry.split(":");
      const name = nameParts.join(":") || `Admin ${chatId}`;

      if (!chatId || !role) {
        console.warn(`[AdminConfig] Invalid admin entry: "${entry}" — expected chatId:role:name`);
        continue;
      }

      if (!ROLES[role]) {
        console.warn(`[AdminConfig] Unknown role "${role}" for chatId ${chatId}. Valid: ${Object.keys(ROLES).join(", ")}`);
        continue;
      }

      admins[chatId] = {
        telegramChatId: chatId,
        role: ROLES[role],
        name,
        active: true,
      };
    }
  }

  return admins;
}

// ============ Permission Checker ============

class PermissionChecker {
  constructor() {
    this.admins = loadAdmins();
    console.log(`[AdminConfig] Loaded ${Object.keys(this.admins).length} admin(s):`);
    for (const [chatId, admin] of Object.entries(this.admins)) {
      console.log(`  ${admin.name} (${admin.role}) — chatId: ${chatId}`);
    }
  }

  /** Check if chatId is a registered admin */
  isAdmin(chatId) {
    const id = String(chatId);
    return !!(this.admins[id] && this.admins[id].active);
  }

  /** Get admin info by chatId */
  getAdmin(chatId) {
    return this.admins[String(chatId)] || null;
  }

  /** Get admin's role */
  getRole(chatId) {
    const admin = this.getAdmin(chatId);
    return admin ? admin.role : null;
  }

  /** Get permissions for a role */
  getPermissions(role) {
    return PERMISSIONS[role] || null;
  }

  /** Check if admin can execute a specific action */
  canExecuteAction(chatId, action) {
    const admin = this.getAdmin(chatId);
    if (!admin) return false;
    const perms = PERMISSIONS[admin.role];
    if (!perms) return false;
    return perms.actions.includes(action);
  }

  /** Check if admin can issue a specific directive */
  canIssueDirective(chatId, directive) {
    const admin = this.getAdmin(chatId);
    if (!admin) return false;
    const perms = PERMISSIONS[admin.role];
    if (!perms) return false;
    return perms.directives.includes(directive);
  }

  /** Check if admin can receive a specific report */
  canReceiveReport(chatId, reportType) {
    const admin = this.getAdmin(chatId);
    if (!admin) return false;
    const perms = PERMISSIONS[admin.role];
    if (!perms) return false;
    return perms.reports.includes(reportType);
  }

  /** Get all admins who should receive a specific report type */
  getReportRecipients(reportType) {
    const recipients = [];
    for (const [chatId, admin] of Object.entries(this.admins)) {
      if (!admin.active) continue;
      const perms = PERMISSIONS[admin.role];
      if (perms && perms.reports.includes(reportType)) {
        recipients.push({ chatId, admin, perms });
      }
    }
    return recipients;
  }

  /** Get all scheduled report configs across all admins */
  getAllScheduledReports() {
    const scheduled = [];
    for (const [chatId, admin] of Object.entries(this.admins)) {
      if (!admin.active) continue;
      const perms = PERMISSIONS[admin.role];
      if (perms && perms.scheduleReports) {
        for (const sr of perms.scheduleReports) {
          scheduled.push({
            chatId,
            adminName: admin.name,
            role: admin.role,
            cron: sr.cron,
            report: sr.report,
          });
        }
      }
    }
    return scheduled;
  }

  /** List all admins (for /admin_list command) */
  listAdmins() {
    return Object.values(this.admins).map(a => ({
      name: a.name,
      role: a.role,
      active: a.active,
      permissions: PERMISSIONS[a.role]?.label || "Unknown",
    }));
  }

  /** Reload admins from env (for dynamic updates) */
  reload() {
    this.admins = loadAdmins();
  }

  /**
   * Reload from Settings Store (JSON file) if available.
   * Falls back to env-based loading if store not found.
   */
  reloadFromStore() {
    try {
      const { AdminMembersStore } = require("./admin-settings-store");
      const store = new AdminMembersStore();
      const members = store.getAll();

      this.admins = {};
      for (const m of members) {
        if (m.status !== "active") continue;
        const chatId = m.chatIdFull || m.chatId;
        this.admins[chatId] = {
          name: m.name,
          role: m.role,
          active: true,
          customPermissions: m.permissions || null,
        };
      }

      console.log(`[AdminConfig] Reloaded ${Object.keys(this.admins).length} admin(s) from Settings Store`);
      return true;
    } catch (err) {
      console.log(`[AdminConfig] Settings Store not available, using env: ${err.message}`);
      this.admins = loadAdmins();
      return false;
    }
  }

  /** Check permissions — supports custom permissions from store */
  _getEffectivePermissions(chatId) {
    const admin = this.getAdmin(chatId);
    if (!admin) return null;

    // If admin has custom permissions from store, use them
    if (admin.customPermissions) {
      return {
        ...PERMISSIONS[admin.role],
        ...admin.customPermissions,
      };
    }
    return PERMISSIONS[admin.role];
  }
}

// ============ Exports ============

module.exports = { ROLES, PERMISSIONS, PermissionChecker, loadAdmins };
