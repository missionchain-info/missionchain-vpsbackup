/**
 * ============================================================
 *  MissionChain — NLP Commander v3.1
 *  Natural Language Processing layer that translates
 *  Vietnamese/English messages into structured actions.
 *
 *  Multi-tier LLM strategy:
 *    Tier 1 (FREE):  Quick keyword regex matching
 *    Tier 2 (CHEAP): Claude Haiku — intent parsing ($0.001/msg)
 *    Tier 3 (CHEAP): Claude Haiku — response formatting ($0.001/msg)
 *    Tier 4 (MID):   Claude Haiku/Sonnet — deep analysis ($0.005/msg)
 *
 *  Typical daily cost for ~50 Telegram messages: ~$0.05-0.10
 * ============================================================
 */

const axios = require("axios");

// ============ Action Registry ============

const ACTIONS = {
  // --- System Status ---
  status:            { description: "Get overall system status — all apps, API, DB health", aliases: ["tình hình", "thế nào", "overview", "tổng quan", "hệ thống", "tinh hinh", "the nao"] },
  deploy_status:     { description: "Check deployment health of all services on Server 1", aliases: ["deploy", "server", "health check", "uptime", "máy chủ"] },

  // --- Smart Contract Operations ---
  contract_status:   { description: "Check smart contract state — deployed addresses, roles, balances", aliases: ["contract", "hợp đồng", "on-chain", "hop dong"] },
  emission_check:    { description: "Check Adaptive Emission Engine status — daily emission, active MICE, pool balances", aliases: ["emission", "phát hành", "mining", "E(t)", "phat hanh"] },
  seed_status:       { description: "Check SEED Round status — sold/remaining, participants, vesting", aliases: ["seed", "seed round", "bán seed", "ban seed"] },
  presale_status:    { description: "Check Pre-Sale status — sold/remaining, referrals, vesting", aliases: ["presale", "pre-sale", "bán presale", "ban presale"] },
  staking_status:    { description: "Check NFT Staking pool — TVL, tiers, rewards distributed", aliases: ["staking", "nft staking", "staking pool"] },
  mice_status:       { description: "Check MICE License status — active licenses, pricing, utilization", aliases: ["mice", "license", "mining license"] },

  // --- App Operations ---
  sophia_status:     { description: "Check SOPHIA AI KOL status — content pipeline, engagement", aliases: ["sophia", "AI KOL", "sophia status"] },
  moderation:        { description: "Check content moderation queue (missionchain.world)", aliases: ["moderation", "content review", "kiểm duyệt", "kiem duyet"] },
  user_stats:        { description: "User statistics — signups, KYC status, wallets connected", aliases: ["users", "người dùng", "KYC", "signups", "nguoi dung"] },

  // --- Orchestra / Audit ---
  audit:             { description: "Run code audit on a phase or file", aliases: ["kiểm tra code", "audit", "review code", "tìm bug", "bug", "security", "kiem tra"] },
  last_report:       { description: "Show the last audit report", aliases: ["báo cáo gần nhất", "last report", "report", "bao cao"] },
  list_reports:      { description: "List all audit reports", aliases: ["danh sách báo cáo", "all reports", "danh sach"] },

  // --- Cost & Budget ---
  cost_report:       { description: "Show cost tracking — how much spent today/month on AI APIs", aliases: ["chi phí", "tốn", "cost", "tiền", "chi phi", "ton", "tien"] },
  budget_status:     { description: "Show budget limits and remaining", aliases: ["budget", "ngân sách", "giới hạn", "ngan sach"] },

  // --- Scheduler ---
  scheduler_start:   { description: "Start automated audit schedule", aliases: ["bật lịch", "auto audit", "schedule on", "bat lich"] },
  scheduler_stop:    { description: "Stop automated audit schedule", aliases: ["tắt lịch", "schedule off", "tat lich"] },
  scheduler_status:  { description: "Show scheduler status and next runs", aliases: ["lịch", "schedule status", "lich"] },

  // --- Emergency ---
  emergency_pause:   { description: "Trigger emergency pause on smart contracts via Gnosis Safe", aliases: ["dừng hết", "emergency", "pause", "khẩn cấp", "tạm dừng", "dung het", "khan cap"] },

  // --- Analysis & Chat ---
  analyze:           { description: "Analyze tokenomics, emission projections, or ecosystem question", aliases: ["phân tích", "analyze", "nhận định", "tokenomics", "phan tich"] },
  chat:              { description: "General conversation, questions, advice", aliases: [] },

  // --- Help ---
  help:              { description: "Show what I can do", aliases: ["giúp", "help", "làm gì được", "giup", "lam gi duoc"] },
};

// ============ MissionChain Knowledge Base (embedded for LLM context) ============

const MC_KNOWLEDGE = `
MissionChain — Hệ sinh thái Web3 đức tin trên BSC (Binance Smart Chain).
Target: 2.6 tỷ tín hữu Kitô giáo toàn cầu.

TOKEN:
- MIC Token (BEP-20): Total Supply 7,000,000,000 (hard cap ERC20Capped)
- Pre-issued 15% = 1,050,000,000 MIC (6 categories: Incentives 0.25%, Seed 3.25%, PreSale 4.50%, DEX/CEX 1.50%, Founders 4%, Treasury 1.50%)
- Mining Pool 85% = 5,950,000,000 MIC (Miners 60%, NFT Staking 20%, DAO 15%, Buyback 5%)

EMISSION:
- E(t) = E_base(t) × D(t) × R(t)
- E_base(t) = E₀ × e^(−λt), E₀ ≈ 22,907,500 MIC/ngày, T_half = 180 ngày
- D(t) = 0.5 + U(t) [0.5, 1.5], R(t) = clamp(250%/ROI, 0.5, 2.0)
- Circuit breakers: cap 5.95B, daily 2× E_base, price floor $0.001, unstake 10%/day

SALES:
- SEED: $0.0025/MIC, KHÔNG bonus, KHÔNG referral, vesting 10% sau 6 tháng + 2.5%/tháng
  Packages: EARLY BIRD $1K→400K MIC+20 MFP-NFT, FP-I $2.5K→1M+60, FP-II $5K→2M+150, FP-III $10K→4M+350
- Pre-Sale: $0.005/MIC, +10% bonus, referral F1:5% F2:2% USDT, vesting tương tự
  Packages: Standard $100→22K, Pro $500→110K, Elite $1K→220K, Diamond $5K→1.1M
- Payment: USDT + BNB only

MICE LICENSE:
- ERC-1155 NFT, 360 ngày, max 100,000, dynamic $300-$1,000
- Revenue: 50% Treasury / 30% Liquidity / 20% Buyback & Burn

NFT STAKING (20% emission):
- MFP-NFT ×10 (cap 1M), Platinum ×5 (500K), Gold ×2.5 (250K), Silver ×1 (100K), No-NFT ×0.5 (50K)
- Time-lock: 30d=1× / 90d=1.25× / 180d=1.5× / 360d=2×

APPS:
- missionchain.info — SSG public site (8 ngôn ngữ)
- missionchain.world — SSR community platform (SOPHIA KOL, Challenges)
- missionchain.io — CSR Web3 DApp (Token, Mining, Staking, Sales)
- admin.missionchain.io — Admin dashboard (RBAC: SUPER_ADMIN, FINANCE, CONTENT, MOD, KYC)
- api.missionchain.io — Fastify shared API

CONTRACTS (10):
MICToken, VestingManager, SeedSale, ReferralRegistry, PreSale, AirdropDistributor, MICELicense, EmissionController, MiningPool, NFTStaking
Admin: Gnosis Safe 3-of-5 multisig, AccessControl (not Ownable)

SOPHIA AI:
- Public-facing Christian AI KOL, mentor, content creator
- Platform: missionchain.world
- Features: SOPHIA WORD (devotionals), Content Creation, Community Challenges
`.trim();

// ============ NLP Commander ============

class NLPCommander {
  constructor(config = {}) {
    this.apiKey = config.anthropicApiKey;
    // Tier 2: Fast + cheap model for intent parsing & response formatting
    this.model = config.model || "claude-haiku-4-5-20251001";
    // Tier 4: Deeper model for analysis conversations (configurable)
    this.analysisModel = config.analysisModel || config.model || "claude-haiku-4-5-20251001";
    this.baseUrl = config.baseUrl || "https://api.anthropic.com/v1";
    this.conversationHistory = [];
    this.maxHistory = 20; // Keep more history for richer conversations
    this.sessionStarted = new Date().toISOString();

    // Conversation context — persisted during session
    this.userContext = {
      language: "vi",     // Default Vietnamese, auto-detected
      lastAction: null,
      lastTarget: null,
      messageCount: 0,
    };
  }

  // ============ Public API ============

  /**
   * Parse a natural language message into a structured action.
   * Tier 1 (regex) -> Tier 2 (Haiku AI) fallback.
   */
  async parse(message) {
    this.userContext.messageCount++;
    this._detectLanguage(message);

    // Tier 1: Quick keyword matching (FREE — no API call)
    const quickMatch = this._quickMatch(message);
    if (quickMatch && quickMatch.confidence >= 0.9) {
      this.userContext.lastAction = quickMatch.action;
      this.userContext.lastTarget = quickMatch.target;
      return quickMatch;
    }

    // Tier 2: Claude Haiku AI parsing (~$0.001 per call)
    const aiResult = await this._aiParse(message);
    this.userContext.lastAction = aiResult.action;
    this.userContext.lastTarget = aiResult.target;
    return aiResult;
  }

  /**
   * Generate a conversational response after an action is executed.
   * Tier 3: Claude Haiku formatting (~$0.001 per call)
   */
  async generateResponse(userMessage, actionResult) {
    try {
      const langInstruction = this.userContext.language === "en"
        ? "Reply in English, concise and professional."
        : "Trả lời bằng tiếng Việt, ngắn gọn, thân thiện, chuyên nghiệp.";

      const response = await this._callClaude(
        this.model,
        `Bạn là MissionChain OpsCommander — trợ lý AI điều hành hệ sinh thái Web3 MissionChain.
${MC_KNOWLEDGE.substring(0, 800)}
${langInstruction}
Không dùng emoji quá nhiều. Dùng HTML tags cho Telegram (<b>, <code>, <i>).
Khi có vấn đề nghiêm trọng (CRITICAL), cảnh báo rõ ràng bằng <b>bold</b>.`,
        [
          ...this.conversationHistory.slice(-6),
          {
            role: "user",
            content: `Người dùng hỏi: "${userMessage}"\n\nKết quả hệ thống:\n${actionResult}\n\nTrả lời tự nhiên, tóm tắt thông tin quan trọng. Dùng HTML cho Telegram.`,
          },
        ],
        1500
      );

      this._addToHistory("user", userMessage);
      this._addToHistory("assistant", response);
      return response;
    } catch (err) {
      console.error(`[NLP] Response generation failed: ${err.message}`);
      return actionResult; // Fallback to raw result
    }
  }

  /**
   * Direct chat — general questions and deep analysis.
   * Tier 4: Uses analysis model for richer responses.
   */
  async chat(message) {
    try {
      this._addToHistory("user", message);

      const langInstruction = this.userContext.language === "en"
        ? "Reply in English, accurate, insightful."
        : "Trả lời bằng tiếng Việt, ngắn gọn, chính xác, có chiều sâu.";

      const response = await this._callClaude(
        this.analysisModel,
        `Bạn là MissionChain AI — chuyên gia Web3 và trợ lý điều hành hệ sinh thái MissionChain.

${MC_KNOWLEDGE}

${langInstruction}
Dùng HTML tags cho Telegram (<b>, <code>, <i>).
Không dùng markdown. Không dùng emoji quá nhiều.
Khi tính toán tokenomics, dùng các số liệu chính xác ở trên.
Khi phân tích, cho ý kiến rõ ràng kèm lý do.`,
        this.conversationHistory.slice(-12),
        2500
      );

      this._addToHistory("assistant", response);
      return response;
    } catch (err) {
      console.error(`[NLP] Chat failed: ${err.message}`);
      return this.userContext.language === "en"
        ? `Sorry, I can't process that right now: ${err.message}`
        : `Xin lỗi, tôi không thể xử lý lúc này: ${err.message}`;
    }
  }

  /**
   * Deep analysis — tokenomics, projections, strategy.
   * Tier 4: Always uses analysis model with full knowledge base.
   */
  async analyze(message) {
    try {
      this._addToHistory("user", message);

      const response = await this._callClaude(
        this.analysisModel,
        `Bạn là MissionChain AI Analyst — phân tích chuyên sâu về tokenomics, emission, và chiến lược ecosystem.

${MC_KNOWLEDGE}

Khi phân tích:
- Tính toán chính xác dựa trên công thức emission E(t) = E_base(t) × D(t) × R(t)
- So sánh với các dự án Web3 tương tự nếu phù hợp
- Đề xuất cải thiện nếu thấy rủi ro
- Dùng số liệu cụ thể, không nói chung chung
- Format kết quả dễ đọc trên Telegram (HTML tags)

Trả lời bằng ${this.userContext.language === "en" ? "English" : "tiếng Việt"}.`,
        this.conversationHistory.slice(-8),
        3000
      );

      this._addToHistory("assistant", response);
      return response;
    } catch (err) {
      console.error(`[NLP] Analysis failed: ${err.message}`);
      return `Analysis error: ${err.message}`;
    }
  }

  // ============ Tier 1: Quick Keyword Matching (FREE) ============

  _quickMatch(message) {
    const lower = message.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const original = message.toLowerCase().trim();

    // Emergency pause — highest priority, must be fast
    if (/dung.*(het|tat|ngay|khan)|emergency|pause.*contract|kill/i.test(original)) {
      return { action: "emergency_pause", target: null, params: {}, confidence: 0.95 };
    }

    // Status — simple greetings that mean "how's it going"
    if (/^(tinh hinh|status|the nao|overview|how.*going|whats up)\??$/i.test(lower)) {
      return { action: "status", target: null, params: {}, confidence: 0.95 };
    }

    // Deploy status
    if (/deploy|server|health.*check|uptime|may chu/i.test(lower)) {
      return { action: "deploy_status", target: null, params: {}, confidence: 0.9 };
    }

    // Emission check
    if (/emission|phat hanh|mining pool|E\(t\)|daily.*emission/i.test(original)) {
      return { action: "emission_check", target: null, params: {}, confidence: 0.9 };
    }

    // SEED status
    if (/seed.*(round|ban|status|tinh|how|sold)/i.test(lower)) {
      return { action: "seed_status", target: null, params: {}, confidence: 0.9 };
    }

    // Pre-Sale status
    if (/pre.?sale|presale/i.test(lower)) {
      return { action: "presale_status", target: null, params: {}, confidence: 0.9 };
    }

    // Staking
    if (/staking|nft.*stak/i.test(lower)) {
      return { action: "staking_status", target: null, params: {}, confidence: 0.9 };
    }

    // MICE
    if (/mice|mining.*license/i.test(lower)) {
      return { action: "mice_status", target: null, params: {}, confidence: 0.9 };
    }

    // Contract status
    if (/^contract|hop dong|on.?chain|smart.*contract/i.test(lower)) {
      return { action: "contract_status", target: null, params: {}, confidence: 0.9 };
    }

    // SOPHIA
    if (/sophia|ai.*kol/i.test(lower)) {
      return { action: "sophia_status", target: null, params: {}, confidence: 0.9 };
    }

    // User stats
    if (/user.*stat|nguoi dung|kyc|signup|bao nhieu.*user/i.test(lower)) {
      return { action: "user_stats", target: null, params: {}, confidence: 0.9 };
    }

    // Moderation
    if (/moderat|kiem duyet|content.*review/i.test(lower)) {
      return { action: "moderation", target: null, params: {}, confidence: 0.9 };
    }

    // Cost
    if (/ton|chi phi|cost|bao nhieu tien|how much.*spent/i.test(lower)) {
      return { action: "cost_report", target: null, params: {}, confidence: 0.9 };
    }

    // Budget
    if (/budget|ngan sach|gioi han/i.test(lower)) {
      return { action: "budget_status", target: null, params: {}, confidence: 0.9 };
    }

    // Help
    if (/^(help|giup|lam gi duoc|huong dan|what can you do)\??$/i.test(lower)) {
      return { action: "help", target: null, params: {}, confidence: 0.95 };
    }

    // Scheduler
    if (/bat.*lich|schedule.*on|auto.*audit|start.*schedule/i.test(lower)) {
      return { action: "scheduler_start", target: null, params: {}, confidence: 0.9 };
    }
    if (/tat.*lich|schedule.*(off|stop)|stop.*schedule/i.test(lower)) {
      return { action: "scheduler_stop", target: null, params: {}, confidence: 0.9 };
    }
    if (/^(lich|schedule.*status)$/i.test(lower)) {
      return { action: "scheduler_status", target: null, params: {}, confidence: 0.9 };
    }

    // Report
    if (/bao cao|report|last.*report/i.test(lower)) {
      return { action: "last_report", target: null, params: {}, confidence: 0.9 };
    }

    // Audit with target detection
    const auditMatch = lower.match(/(?:kiem tra|audit|review|tim bug|check|security|scan).*(code|contract|api|web|frontend|backend|sdk|db|database|info|world|orchestra|full|tat ca|everything)/i);
    if (auditMatch) {
      const targetMap = {
        "contract": "contracts", "contracts": "contracts", "sol": "contracts", "solidity": "contracts",
        "api": "api", "backend": "api", "fastify": "api",
        "web": "web", "frontend": "web", "dapp": "web", "nextjs": "web",
        "sdk": "sdk",
        "db": "db", "database": "db", "prisma": "db",
        "info": "info", "website": "info",
        "world": "world", "community": "world",
        "orchestra": "orchestra",
        "full": "full", "code": "full", "tat ca": "full", "everything": "full",
      };
      const target = targetMap[auditMatch[1].toLowerCase()] || "full";
      return { action: "audit", target, params: {}, confidence: 0.9 };
    }

    // Tokenomics analysis keywords
    if (/phan tich|tokenomics|roi.*projection|emission.*project|analyze/i.test(lower)) {
      return { action: "analyze", target: null, params: {}, confidence: 0.85 };
    }

    // Not confident enough — fall through to Tier 2 AI
    return null;
  }

  // ============ Tier 2: AI-Powered Parsing (Haiku ~$0.001) ============

  async _aiParse(message) {
    const actionList = Object.entries(ACTIONS)
      .map(([key, val]) => `- "${key}": ${val.description}`)
      .join("\n");

    try {
      const response = await this._callClaude(
        this.model,
        `Bạn là parser chuyển ngôn ngữ tự nhiên thành action có cấu trúc.
Người dùng gửi tin nhắn bằng tiếng Việt hoặc tiếng Anh về hệ sinh thái Web3 MissionChain.
MissionChain gồm: 10 smart contracts (BSC), 3 Next.js apps, Fastify API, SOPHIA AI KOL.

Danh sách actions:
${actionList}

Audit targets: contracts, contract-tests, deploy, sdk, db, api, web, info, world, orchestra, full

Trả về JSON duy nhất, không giải thích:
{"action": "action_name", "target": "target_or_null", "params": {}}

Nếu là câu hỏi phân tích tokenomics, emission, strategy → action: "analyze"
Nếu hỏi về action trước đó (context: last action = "${this.userContext.lastAction}") → liên kết context
Nếu là hội thoại chung → action: "chat"
Nếu không rõ → action: "chat"`,
        [
          ...this.conversationHistory.slice(-4),
          { role: "user", content: message },
        ],
        500
      );

      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          action: parsed.action || "chat",
          target: parsed.target || null,
          params: parsed.params || {},
          confidence: 0.85,
        };
      }
    } catch (err) {
      console.error(`[NLP] AI parse failed: ${err.message}`);
    }

    // Fallback: treat as chat
    return { action: "chat", target: null, params: {}, confidence: 0.5 };
  }

  // ============ Unified Claude API Caller ============

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
        timeout: 30000,
      }
    );

    return response.data.content[0].text;
  }

  // ============ Helpers ============

  _addToHistory(role, content) {
    this.conversationHistory.push({ role, content });
    if (this.conversationHistory.length > this.maxHistory * 2) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistory);
    }
  }

  _detectLanguage(message) {
    // Simple heuristic: Vietnamese has tone marks or common Vietnamese words
    const vnPattern = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i;
    const vnWords = /\b(của|và|là|có|không|được|với|từ|cho|này|để|bạn|tôi|mình|vui|xin|cảm|ơn)\b/i;

    if (vnPattern.test(message) || vnWords.test(message)) {
      this.userContext.language = "vi";
    } else if (/^[a-zA-Z0-9\s.,!?;:'"()\-]+$/.test(message)) {
      this.userContext.language = "en";
    }
    // else keep current
  }

  /** Get current session stats */
  getStats() {
    return {
      sessionStarted: this.sessionStarted,
      messageCount: this.userContext.messageCount,
      historySize: this.conversationHistory.length,
      detectedLanguage: this.userContext.language,
      lastAction: this.userContext.lastAction,
      model: this.model,
      analysisModel: this.analysisModel,
    };
  }

  /** Clear conversation history */
  clearHistory() {
    this.conversationHistory = [];
    this.userContext.messageCount = 0;
    this.userContext.lastAction = null;
    this.userContext.lastTarget = null;
  }
}

// ============ Exports ============

module.exports = { NLPCommander, ACTIONS, MC_KNOWLEDGE };
