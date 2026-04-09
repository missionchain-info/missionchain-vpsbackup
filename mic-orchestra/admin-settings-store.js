/**
 * ============================================================
 *  MissionChain — Admin Settings Store v4.0
 *  Persistent storage for Admin Members + AI Configuration
 *  Reads/writes JSON config files + updates .env when needed
 * ============================================================
 */

const fs = require("fs");
const path = require("path");

const CONFIG_DIR = path.join(__dirname, "config");
const MEMBERS_FILE = path.join(CONFIG_DIR, "admin-members.json");
const AI_CONFIG_FILE = path.join(CONFIG_DIR, "ai-config.json");
const ENV_FILE = path.join(__dirname, "..", ".env");

// ============ Helpers ============

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readJSON(filePath, fallback = null) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (e) {
    console.error(`[Store] Error reading ${filePath}: ${e.message}`);
  }
  return fallback;
}

function writeJSON(filePath, data) {
  ensureConfigDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ============ Admin Members Store ============

const VALID_ROLES = ["SUPER_ADMIN", "FINANCE_ADMIN", "CONTENT_ADMIN", "MODERATOR", "KYC_REVIEWER"];

const DEFAULT_ROLE_PERMISSIONS = {
  SUPER_ADMIN: {
    actions: ["*"],
    reports: ["daily_summary", "financial_report", "security_report", "user_report", "content_report", "performance_report"],
    directives: ["*"],
    scheduleReports: [
      { type: "daily_summary", cron: "0 8 * * *" },
      { type: "financial_report", cron: "0 9 * * 1" },
      { type: "security_report", cron: "0 7 * * *" },
    ],
  },
  FINANCE_ADMIN: {
    actions: ["status", "seed_status", "presale_status", "emission_check", "mice_status", "cost_report", "budget_status"],
    reports: ["daily_summary", "financial_report"],
    directives: ["content_edit", "notification_send"],
    scheduleReports: [
      { type: "financial_report", cron: "0 8 * * *" },
      { type: "daily_summary", cron: "0 9 * * 1" },
    ],
  },
  CONTENT_ADMIN: {
    actions: ["status", "sophia_status", "moderation", "user_stats", "deploy_status"],
    reports: ["content_report", "user_report"],
    directives: ["ui_copy", "content_create", "content_edit", "content_translate", "notification_send"],
    scheduleReports: [
      { type: "content_report", cron: "0 8 * * *" },
      { type: "user_report", cron: "0 10 * * 1" },
    ],
  },
  MODERATOR: {
    actions: ["status", "moderation", "user_stats"],
    reports: ["content_report"],
    directives: ["content_edit"],
    scheduleReports: [
      { type: "content_report", cron: "0 9 * * *" },
    ],
  },
  KYC_REVIEWER: {
    actions: ["user_stats"],
    reports: ["user_report"],
    directives: ["user_manage"],
    scheduleReports: [
      { type: "user_report", cron: "0 9 * * *" },
    ],
  },
};

class AdminMembersStore {
  constructor() {
    this.members = this._load();
  }

  _load() {
    const stored = readJSON(MEMBERS_FILE);
    if (stored && Array.isArray(stored.members)) {
      return stored.members;
    }
    // Bootstrap from env vars (first-time migration)
    return this._bootstrapFromEnv();
  }

  _bootstrapFromEnv() {
    const members = [];
    const primaryChatId = process.env.TELEGRAM_CHAT_ID;
    const primaryName = process.env.ADMIN_PRIMARY_NAME || "Admin";

    if (primaryChatId) {
      members.push({
        id: this._generateId(),
        chatId: primaryChatId,
        name: primaryName,
        role: "SUPER_ADMIN",
        permissions: { ...DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN },
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // Parse ADMIN_USERS env var
    const adminUsersStr = process.env.ADMIN_USERS || "";
    if (adminUsersStr) {
      const entries = adminUsersStr.split(",").filter(Boolean);
      for (const entry of entries) {
        const [chatId, role, ...nameParts] = entry.trim().split(":");
        const name = nameParts.join(":") || `Admin-${chatId}`;
        if (chatId && VALID_ROLES.includes(role)) {
          members.push({
            id: this._generateId(),
            chatId: chatId.trim(),
            name: name.trim(),
            role,
            permissions: { ...DEFAULT_ROLE_PERMISSIONS[role] },
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }

    if (members.length > 0) {
      this._save(members);
    }
    return members;
  }

  _save(members = null) {
    const data = {
      version: "4.0",
      updatedAt: new Date().toISOString(),
      members: members || this.members,
    };
    writeJSON(MEMBERS_FILE, data);
  }

  _generateId() {
    return `adm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---- CRUD ----

  getAll() {
    return this.members.map(m => ({
      ...m,
      chatId: this._maskChatId(m.chatId),
      chatIdFull: m.chatId,  // Only returned to SUPER_ADMIN
    }));
  }

  getById(id) {
    return this.members.find(m => m.id === id) || null;
  }

  getByChatId(chatId) {
    return this.members.find(m => m.chatId === chatId) || null;
  }

  add({ chatId, name, role, permissions }) {
    // Validate
    if (!chatId || !name || !role) {
      return { success: false, error: "chatId, name, and role are required" };
    }
    if (!VALID_ROLES.includes(role)) {
      return { success: false, error: `Invalid role. Valid: ${VALID_ROLES.join(", ")}` };
    }
    if (this.members.some(m => m.chatId === chatId)) {
      return { success: false, error: `Admin with chatId ${this._maskChatId(chatId)} already exists` };
    }

    const member = {
      id: this._generateId(),
      chatId: chatId.trim(),
      name: name.trim(),
      role,
      permissions: permissions || { ...DEFAULT_ROLE_PERMISSIONS[role] },
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.members.push(member);
    this._save();
    this._syncToEnv();
    return { success: true, member };
  }

  update(id, updates) {
    const idx = this.members.findIndex(m => m.id === id);
    if (idx === -1) return { success: false, error: "Member not found" };

    const member = this.members[idx];

    // Cannot demote the last SUPER_ADMIN
    if (member.role === "SUPER_ADMIN" && updates.role && updates.role !== "SUPER_ADMIN") {
      const superAdminCount = this.members.filter(m => m.role === "SUPER_ADMIN" && m.status === "active").length;
      if (superAdminCount <= 1) {
        return { success: false, error: "Cannot demote the last SUPER_ADMIN" };
      }
    }

    // Apply updates
    if (updates.name) member.name = updates.name.trim();
    if (updates.role && VALID_ROLES.includes(updates.role)) {
      member.role = updates.role;
      // Reset permissions to role default if role changed (unless custom permissions provided)
      if (!updates.permissions) {
        member.permissions = { ...DEFAULT_ROLE_PERMISSIONS[updates.role] };
      }
    }
    if (updates.permissions) {
      member.permissions = {
        ...member.permissions,
        ...updates.permissions,
      };
    }
    if (updates.status && ["active", "suspended"].includes(updates.status)) {
      member.status = updates.status;
    }

    member.updatedAt = new Date().toISOString();
    this.members[idx] = member;
    this._save();
    this._syncToEnv();
    return { success: true, member };
  }

  remove(id) {
    const idx = this.members.findIndex(m => m.id === id);
    if (idx === -1) return { success: false, error: "Member not found" };

    const member = this.members[idx];

    // Cannot remove last SUPER_ADMIN
    if (member.role === "SUPER_ADMIN") {
      const superAdminCount = this.members.filter(m => m.role === "SUPER_ADMIN" && m.status === "active").length;
      if (superAdminCount <= 1) {
        return { success: false, error: "Cannot remove the last SUPER_ADMIN" };
      }
    }

    this.members.splice(idx, 1);
    this._save();
    this._syncToEnv();
    return { success: true, removed: member };
  }

  // ---- Sync to .env ----

  _syncToEnv() {
    try {
      const activeMembers = this.members.filter(m => m.status === "active");
      const superAdmin = activeMembers.find(m => m.role === "SUPER_ADMIN");
      const others = activeMembers.filter(m => m.role !== "SUPER_ADMIN" || m !== superAdmin);

      const envUpdates = {};
      if (superAdmin) {
        envUpdates.TELEGRAM_CHAT_ID = superAdmin.chatId;
        envUpdates.ADMIN_PRIMARY_NAME = superAdmin.name;
      }
      if (others.length > 0) {
        envUpdates.ADMIN_USERS = others.map(m => `${m.chatId}:${m.role}:${m.name}`).join(",");
      } else {
        envUpdates.ADMIN_USERS = "";
      }

      updateEnvFile(envUpdates);
    } catch (err) {
      console.error(`[Store] Failed to sync members to .env: ${err.message}`);
    }
  }

  _maskChatId(chatId) {
    if (!chatId || chatId.length < 5) return "****";
    return chatId.slice(0, 3) + "***" + chatId.slice(-2);
  }

  getValidRoles() {
    return VALID_ROLES;
  }

  getDefaultPermissions(role) {
    return DEFAULT_ROLE_PERMISSIONS[role] || null;
  }

  /** Reload members from file (after external changes) */
  reload() {
    this.members = this._load();
    return this.members;
  }
}

// ============ AI Config Store ============

const DEFAULT_AI_CONFIG = {
  providers: {
    anthropic: {
      name: "Anthropic (Claude)",
      role: "Builder & Synthesizer",
      description: "Proposes fixes, synthesizes debates, generates reports",
      apiKey: "",
      models: {
        primary: "claude-sonnet-4-20250514",
        fallback: "claude-haiku-4-5-20251001",
        nlp: "claude-haiku-4-5-20251001",
        analysis: "claude-haiku-4-5-20251001",
        directive: "claude-sonnet-4-20250514",
      },
      enabled: true,
      required: true,
    },
    openai: {
      name: "OpenAI (Codex)",
      role: "Auditor #1 — Security",
      description: "Security-focused code audit, vulnerability scanning, Web3 risks",
      apiKey: "",
      models: {
        primary: "o1",
        fallback: "gpt-4o",
      },
      enabled: true,
      required: true,
    },
    google: {
      name: "Google (Gemini)",
      role: "Auditor #2 — Architecture",
      description: "Architecture review, logic analysis, gas optimization, economic attacks",
      apiKey: "",
      models: {
        primary: "gemini-2.5-flash",
        fallback: "gemini-2.0-flash",
      },
      enabled: false,  // Auto-enabled when GOOGLE_AI_API_KEY is set (see _bootstrapFromEnv)
      required: false,  // Orchestra falls back to 2-model if disabled
    },
  },
  orchestraFlow: {
    description: "3-Model Tribunal: Codex + Gemini audit independently → Claude synthesizes → Debate → Human decides",
    steps: [
      { order: 1, provider: "openai", action: "audit", label: "Codex audits (security focus)" },
      { order: 2, provider: "google", action: "audit", label: "Gemini audits (architecture focus)" },
      { order: 3, provider: "anthropic", action: "respond", label: "Claude proposes fixes" },
      { order: 4, provider: "all", action: "debate", label: "3-way debate (max 3 rounds)" },
      { order: 5, provider: "anthropic", action: "synthesize", label: "Claude synthesizes → Report to Admin" },
    ],
  },
  budget: {
    dailyBudget: 20,
    monthlyBudget: 300,
  },
  telegram: {
    botToken: "",
    primaryChatId: "",
  },
};

class AIConfigStore {
  constructor() {
    this.config = this._load();
  }

  _load() {
    const stored = readJSON(AI_CONFIG_FILE);
    if (stored && stored.providers) {
      // Merge with defaults to pick up new fields
      return this._mergeDefaults(stored);
    }
    // Bootstrap from env
    return this._bootstrapFromEnv();
  }

  _mergeDefaults(stored) {
    const merged = JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));
    // Overwrite with stored values
    for (const [key, provider] of Object.entries(stored.providers || {})) {
      if (merged.providers[key]) {
        Object.assign(merged.providers[key], provider);
      }
    }
    if (stored.orchestraFlow) merged.orchestraFlow = stored.orchestraFlow;
    if (stored.budget) Object.assign(merged.budget, stored.budget);
    if (stored.telegram) Object.assign(merged.telegram, stored.telegram);
    return merged;
  }

  _bootstrapFromEnv() {
    const config = JSON.parse(JSON.stringify(DEFAULT_AI_CONFIG));

    // Read API keys from env (store masked versions)
    if (process.env.ANTHROPIC_API_KEY) {
      config.providers.anthropic.apiKey = process.env.ANTHROPIC_API_KEY;
      config.providers.anthropic.enabled = true;
    }
    if (process.env.OPENAI_API_KEY) {
      config.providers.openai.apiKey = process.env.OPENAI_API_KEY;
      config.providers.openai.enabled = true;
    }
    if (process.env.GOOGLE_AI_API_KEY) {
      config.providers.google.apiKey = process.env.GOOGLE_AI_API_KEY;
      config.providers.google.enabled = true;
    }

    // Read model overrides
    if (process.env.CLAUDE_MODEL) config.providers.anthropic.models.primary = process.env.CLAUDE_MODEL;
    if (process.env.CLAUDE_FALLBACK_MODEL) config.providers.anthropic.models.fallback = process.env.CLAUDE_FALLBACK_MODEL;
    if (process.env.NLP_MODEL) config.providers.anthropic.models.nlp = process.env.NLP_MODEL;
    if (process.env.NLP_ANALYSIS_MODEL) config.providers.anthropic.models.analysis = process.env.NLP_ANALYSIS_MODEL;
    if (process.env.ADMIN_DIRECTIVE_MODEL) config.providers.anthropic.models.directive = process.env.ADMIN_DIRECTIVE_MODEL;
    if (process.env.CODEX_MODEL) config.providers.openai.models.primary = process.env.CODEX_MODEL;
    if (process.env.CODEX_FALLBACK_MODEL) config.providers.openai.models.fallback = process.env.CODEX_FALLBACK_MODEL;
    if (process.env.GEMINI_MODEL) config.providers.google.models.primary = process.env.GEMINI_MODEL;
    if (process.env.GEMINI_FALLBACK_MODEL) config.providers.google.models.fallback = process.env.GEMINI_FALLBACK_MODEL;

    // Budget
    if (process.env.ORCHESTRA_DAILY_BUDGET) config.budget.dailyBudget = parseFloat(process.env.ORCHESTRA_DAILY_BUDGET);
    if (process.env.ORCHESTRA_MONTHLY_BUDGET) config.budget.monthlyBudget = parseFloat(process.env.ORCHESTRA_MONTHLY_BUDGET);

    // Telegram
    if (process.env.TELEGRAM_BOT_TOKEN) config.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (process.env.TELEGRAM_CHAT_ID) config.telegram.primaryChatId = process.env.TELEGRAM_CHAT_ID;

    this._save(config);
    return config;
  }

  _save(config = null) {
    const data = config || this.config;
    // Save with masked API keys to JSON (actual keys stay in .env)
    const toStore = JSON.parse(JSON.stringify(data));
    for (const provider of Object.values(toStore.providers)) {
      if (provider.apiKey) {
        provider.apiKeySet = true;
        provider.apiKeyPreview = this._maskKey(provider.apiKey);
        delete provider.apiKey;  // Don't store raw keys in JSON
      }
    }
    if (toStore.telegram.botToken) {
      toStore.telegram.botTokenSet = true;
      toStore.telegram.botTokenPreview = this._maskKey(toStore.telegram.botToken);
      delete toStore.telegram.botToken;
    }
    toStore.version = "4.0";
    toStore.updatedAt = new Date().toISOString();
    writeJSON(AI_CONFIG_FILE, toStore);
  }

  // ---- Read ----

  getConfig() {
    // Return config with masked keys for UI display
    const display = JSON.parse(JSON.stringify(this.config));
    for (const [key, provider] of Object.entries(display.providers)) {
      if (provider.apiKey) {
        display.providers[key].apiKeyPreview = this._maskKey(provider.apiKey);
        display.providers[key].apiKeySet = true;
        delete display.providers[key].apiKey;
      }
    }
    if (display.telegram.botToken) {
      display.telegram.botTokenPreview = this._maskKey(display.telegram.botToken);
      display.telegram.botTokenSet = true;
      delete display.telegram.botToken;
    }
    return display;
  }

  getProvider(name) {
    return this.config.providers[name] || null;
  }

  // ---- Update ----

  updateProvider(name, updates) {
    if (!this.config.providers[name]) {
      return { success: false, error: `Unknown provider: ${name}` };
    }

    const provider = this.config.providers[name];

    if (updates.models) {
      provider.models = { ...provider.models, ...updates.models };
    }
    if (typeof updates.enabled === "boolean") {
      if (provider.required && !updates.enabled) {
        return { success: false, error: `${provider.name} is required and cannot be disabled` };
      }
      provider.enabled = updates.enabled;
    }
    if (updates.role) provider.role = updates.role;
    if (updates.description) provider.description = updates.description;

    // API key update → write to .env
    if (updates.apiKey && updates.apiKey.trim()) {
      provider.apiKey = updates.apiKey.trim();
      this._syncProviderKeyToEnv(name, provider.apiKey);
    }

    this._save();
    return { success: true, provider: name };
  }

  updateBudget(budget) {
    if (budget.dailyBudget !== undefined) {
      this.config.budget.dailyBudget = Math.max(1, parseFloat(budget.dailyBudget));
    }
    if (budget.monthlyBudget !== undefined) {
      this.config.budget.monthlyBudget = Math.max(10, parseFloat(budget.monthlyBudget));
    }
    this._save();
    this._syncBudgetToEnv();
    return { success: true, budget: this.config.budget };
  }

  updateTelegram({ botToken, primaryChatId }) {
    if (botToken && botToken.trim()) {
      this.config.telegram.botToken = botToken.trim();
    }
    if (primaryChatId && primaryChatId.trim()) {
      this.config.telegram.primaryChatId = primaryChatId.trim();
    }
    this._save();
    this._syncTelegramToEnv();
    return { success: true };
  }

  updateFlow(flow) {
    if (flow.steps && Array.isArray(flow.steps)) {
      this.config.orchestraFlow.steps = flow.steps;
    }
    if (flow.description) {
      this.config.orchestraFlow.description = flow.description;
    }
    this._save();
    return { success: true, flow: this.config.orchestraFlow };
  }

  // ---- Full save (from dashboard) ----

  saveAll(data) {
    const results = { providers: {}, budget: null, telegram: null, flow: null };

    // Update each provider
    if (data.providers) {
      for (const [name, updates] of Object.entries(data.providers)) {
        results.providers[name] = this.updateProvider(name, updates);
      }
    }

    // Budget
    if (data.budget) {
      results.budget = this.updateBudget(data.budget);
    }

    // Telegram
    if (data.telegram) {
      results.telegram = this.updateTelegram(data.telegram);
    }

    // Flow
    if (data.flow) {
      results.flow = this.updateFlow(data.flow);
    }

    return { success: true, results };
  }

  // ---- .env Sync ----

  _syncProviderKeyToEnv(name, apiKey) {
    const keyMap = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_AI_API_KEY",
    };
    const envKey = keyMap[name];
    if (envKey) {
      updateEnvFile({ [envKey]: apiKey });
    }

    // Also sync model configs
    const provider = this.config.providers[name];
    const modelMap = {
      anthropic: {
        CLAUDE_MODEL: provider.models.primary,
        CLAUDE_FALLBACK_MODEL: provider.models.fallback,
        NLP_MODEL: provider.models.nlp,
        NLP_ANALYSIS_MODEL: provider.models.analysis,
        ADMIN_DIRECTIVE_MODEL: provider.models.directive,
      },
      openai: {
        CODEX_MODEL: provider.models.primary,
        CODEX_FALLBACK_MODEL: provider.models.fallback,
      },
      google: {
        GEMINI_MODEL: provider.models.primary,
        GEMINI_FALLBACK_MODEL: provider.models.fallback,
      },
    };

    if (modelMap[name]) {
      updateEnvFile(modelMap[name]);
    }
  }

  _syncBudgetToEnv() {
    updateEnvFile({
      ORCHESTRA_DAILY_BUDGET: String(this.config.budget.dailyBudget),
      ORCHESTRA_MONTHLY_BUDGET: String(this.config.budget.monthlyBudget),
    });
  }

  _syncTelegramToEnv() {
    const updates = {};
    if (this.config.telegram.botToken) updates.TELEGRAM_BOT_TOKEN = this.config.telegram.botToken;
    if (this.config.telegram.primaryChatId) updates.TELEGRAM_CHAT_ID = this.config.telegram.primaryChatId;
    updateEnvFile(updates);
  }

  _maskKey(key) {
    if (!key || key.length < 8) return "****";
    return key.slice(0, 6) + "..." + key.slice(-4);
  }

  /** Reload config from file */
  reload() {
    this.config = this._load();
    return this.getConfig();
  }
}

// ============ .env File Updater ============

function updateEnvFile(updates) {
  let envContent = "";
  try {
    if (fs.existsSync(ENV_FILE)) {
      envContent = fs.readFileSync(ENV_FILE, "utf-8");
    }
  } catch (e) {
    console.error(`[Store] Cannot read .env: ${e.message}`);
    return;
  }

  const lines = envContent.split("\n");

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    const newLine = `${key}=${value}`;

    if (regex.test(envContent)) {
      // Update existing line
      envContent = envContent.replace(regex, newLine);
    } else {
      // Append new line (find the right section or add at end)
      envContent = envContent.trimEnd() + "\n" + newLine + "\n";
    }
  }

  try {
    fs.writeFileSync(ENV_FILE, envContent, "utf-8");
    console.log(`[Store] Updated .env: ${Object.keys(updates).join(", ")}`);
  } catch (e) {
    console.error(`[Store] Cannot write .env: ${e.message}`);
  }
}

// ============ Exports ============

module.exports = {
  AdminMembersStore,
  AIConfigStore,
  DEFAULT_ROLE_PERMISSIONS,
  VALID_ROLES,
  updateEnvFile,
};
