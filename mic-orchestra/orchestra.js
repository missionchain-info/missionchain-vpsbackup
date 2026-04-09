/**
 * ============================================================
 *  MissionChain — AI Orchestra v4.0
 *  3-model tribunal: Codex (Auditor #1) + Gemini (Auditor #2)
 *  + Claude (Builder & Synthesizer), with multi-party debate,
 *  cost tracking, retry logic, and unified reporting.
 * ============================================================
 *
 *  MissionChain ecosystem audit system for:
 *    - 10 Solidity smart contracts (BSC)
 *    - Next.js DApp frontend (missionchain.io)
 *    - Fastify backend API (api.missionchain.io)
 *    - Shared SDK (ABIs, types, constants)
 *    - Prisma database schema
 *    - Orchestra self-audit
 *
 *  Usage:
 *    node mic-orchestra/orchestra.js audit <file>
 *    node mic-orchestra/orchestra.js phase <phase-name>
 *    node mic-orchestra/orchestra.js full-audit
 *    node mic-orchestra/orchestra.js debate <topic>
 *    node mic-orchestra/orchestra.js cost-report
 * ============================================================
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), override: true });
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const ModelPolicy = require("./model-policy");

// ============ Configuration ============

const CONFIG = {
  // OpenAI (Codex) — auditor role
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.CODEX_MODEL || "o1",
    fallbackModel: process.env.CODEX_FALLBACK_MODEL || "gpt-4o",
    baseUrl: "https://api.openai.com/v1",
    maxTokens: 16000,
  },

  // Google (Gemini) — auditor #2 role
  google: {
    apiKey: process.env.GOOGLE_AI_API_KEY,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    fallbackModel: process.env.GEMINI_FALLBACK_MODEL || "gemini-2.0-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    maxTokens: 16000,
  },

  // Anthropic (Claude) — builder + synthesizer role
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
    fallbackModel: process.env.CLAUDE_FALLBACK_MODEL || "claude-haiku-4-5-20251001",
    baseUrl: "https://api.anthropic.com/v1",
    maxTokens: 8000,
  },

  // Orchestra settings
  orchestra: {
    maxDebateRounds: 3,
    reportDir: path.join(__dirname, "..", "reports"),
    telegramEnabled: true,
  },

  // Cost tracking
  cost: {
    // Approximate per-1K-token pricing (input/output)
    rates: {
      "o1":                          { input: 0.015, output: 0.060 },
      "gpt-4o":                      { input: 0.005, output: 0.015 },
      "gemini-2.5-flash":            { input: 0.00015, output: 0.0006 },
      "gemini-2.5-pro":              { input: 0.00125, output: 0.010 },
      "gemini-2.0-flash":            { input: 0.0001, output: 0.0004 },
      "claude-sonnet-4-20250514":    { input: 0.003, output: 0.015 },
      "claude-haiku-4-5-20251001":   { input: 0.001, output: 0.005 },
    },
    dailyBudget: parseFloat(process.env.ORCHESTRA_DAILY_BUDGET || "20"),  // USD
    monthlyBudget: parseFloat(process.env.ORCHESTRA_MONTHLY_BUDGET || "300"),
    trackingFile: path.join(__dirname, "..", "reports", "cost-tracking.json"),
  },

  // Retry
  retry: {
    maxRetries: 3,
    baseDelay: 2000,   // 2s -> 4s -> 8s exponential
    maxDelay: 30000,
  },

  // Telegram
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
};

// ============ Cost Tracker ============

class CostTracker {
  constructor() {
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(CONFIG.cost.trackingFile)) {
        return JSON.parse(fs.readFileSync(CONFIG.cost.trackingFile, "utf-8"));
      }
    } catch (e) { /* start fresh */ }
    return { daily: {}, monthly: {}, total: 0, calls: [] };
  }

  _save() {
    const dir = path.dirname(CONFIG.cost.trackingFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG.cost.trackingFile, JSON.stringify(this.data, null, 2));
  }

  /**
   * Record an API call cost
   * @param {string} model - Model name
   * @param {number} inputTokens - Approximate input tokens
   * @param {number} outputTokens - Approximate output tokens
   * @returns {number} estimated cost in USD
   */
  record(model, inputTokens, outputTokens) {
    const rates = CONFIG.cost.rates[model] || { input: 0.01, output: 0.03 };
    const cost = (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;

    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);

    this.data.daily[today] = (this.data.daily[today] || 0) + cost;
    this.data.monthly[month] = (this.data.monthly[month] || 0) + cost;
    this.data.total += cost;
    this.data.calls.push({
      model, inputTokens, outputTokens, cost: +cost.toFixed(4),
      timestamp: new Date().toISOString(),
    });

    // Keep only last 500 calls in memory
    if (this.data.calls.length > 500) {
      this.data.calls = this.data.calls.slice(-500);
    }

    this._save();
    return cost;
  }

  /** Check if within budget */
  canSpend() {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const dailySpent = this.data.daily[today] || 0;
    const monthlySpent = this.data.monthly[month] || 0;

    if (dailySpent >= CONFIG.cost.dailyBudget) {
      return { ok: false, reason: `Daily budget exceeded: $${dailySpent.toFixed(2)} / $${CONFIG.cost.dailyBudget}` };
    }
    if (monthlySpent >= CONFIG.cost.monthlyBudget) {
      return { ok: false, reason: `Monthly budget exceeded: $${monthlySpent.toFixed(2)} / $${CONFIG.cost.monthlyBudget}` };
    }
    return { ok: true, dailySpent, monthlySpent };
  }

  /** Get summary for reporting */
  summary() {
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    return {
      today: +(this.data.daily[today] || 0).toFixed(4),
      thisMonth: +(this.data.monthly[month] || 0).toFixed(4),
      allTime: +this.data.total.toFixed(4),
      totalCalls: this.data.calls.length,
      dailyBudget: CONFIG.cost.dailyBudget,
      monthlyBudget: CONFIG.cost.monthlyBudget,
    };
  }
}

// ============ Retry Helper ============

async function withRetry(fn, label = "API call") {
  let lastError;
  for (let attempt = 0; attempt < CONFIG.retry.maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const status = err.response?.status;

      // Don't retry on auth errors or invalid requests
      if (status === 401 || status === 403 || status === 400) throw err;

      const delay = Math.min(
        CONFIG.retry.baseDelay * Math.pow(2, attempt),
        CONFIG.retry.maxDelay
      );
      console.log(`[Retry] ${label} attempt ${attempt + 1} failed (${err.message}), retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ============ AI Clients ============

class CodexClient {
  constructor(costTracker) {
    this.apiKey = CONFIG.openai.apiKey;
    this.model = CONFIG.openai.model;
    this.fallbackModel = CONFIG.openai.fallbackModel;
    this.costTracker = costTracker;
    if (!this.apiKey) throw new Error("OPENAI_API_KEY not set in .env");
  }

  async audit(code, context = "") {
    const systemPrompt = `You are CODEX — a senior Web3 security auditor and full-stack expert for MissionChain.
MissionChain is a faith-based Web3 ecosystem on Binance Smart Chain (BSC) with:
- 10 Solidity smart contracts (MICToken BEP-20, VestingManager, SeedSale, PreSale, ReferralRegistry, AirdropDistributor, MICELicense ERC-1155, EmissionController, MiningPool, NFTStaking)
- Total supply: 7B MIC (hard cap via ERC20Capped), 15% pre-issued, 85% minted progressively by EmissionController
- Next.js 14 DApp frontend, Fastify backend API, Prisma ORM, PostgreSQL
- Gnosis Safe 3-of-5 multisig admin, AccessControl (not Ownable)
- PancakeSwap V3 TWAP oracle (primary), Chainlink (fallback)

Your role is AUDIT ONLY. You find:
- Critical bugs (logic errors, race conditions, reentrancy, integer overflow, unhandled promises)
- Security vulnerabilities (API key exposure, injection, unauthorized access, missing ReentrancyGuard)
- Smart contract risks (reentrancy, front-running, oracle manipulation, flash loan attacks, unchecked external calls)
- Token economics issues (emission cap bypass, vesting calculation errors, referral abuse)
- BSC-specific risks (gas limits, BEP-20 compliance, USDT 6-decimal vs MIC 18-decimal conversion)
- Access control issues (MINTER_ROLE, DEFAULT_ADMIN_ROLE assignment, role escalation)
- API security (JWT validation, rate limiting, CORS, input sanitization)
- Frontend security (XSS, CSRF, wallet injection, signature verification)
- Performance issues (unnecessary loops, blocking calls, N+1 queries)
- Architecture concerns (coupling, error propagation, state management)

IMPORTANT: Return your findings as a JSON array. Each item must have:
{
  "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
  "title": "Short title",
  "file": "filename or line reference",
  "description": "What's wrong",
  "impact": "What could go wrong",
  "confidence": 8
}

If the code is clean, return: []
Wrap your JSON in \`\`\`json ... \`\`\` markers.`;

    const userPrompt = `${context ? `Context: ${context}\n\n` : ""}Audit this code:\n\n\`\`\`\n${code}\n\`\`\``;

    return this._call(systemPrompt, userPrompt, "audit");
  }

  async respond(finding, claudeLatestResponse) {
    const systemPrompt = `You are CODEX — a senior Web3 security auditor in a technical debate about MissionChain code.
Claude (the builder) has responded to your audit finding. Evaluate their LATEST response:
- If their fix is correct and complete -> respond with [AGREE]
- If their fix is partial -> respond with [PARTIALLY AGREE] + explain gaps
- If their fix is wrong -> respond with [DISAGREE] + explain why
- If your original finding was wrong -> respond with [CONCEDE]

Be objective. The goal is correct, secure code — not winning.
Start your response with the verdict tag: [AGREE], [PARTIALLY AGREE], [DISAGREE], or [CONCEDE]`;

    const userPrompt = `Your original finding:\n${finding}\n\nClaude's LATEST response:\n${claudeLatestResponse}`;

    return this._call(systemPrompt, userPrompt, "debate");
  }

  async _call(systemPrompt, userPrompt, label = "codex") {
    return withRetry(async (attempt) => {
      // Use fallback model on retry attempts >= 2
      const model = attempt >= 2 ? this.fallbackModel : this.model;

      const response = await axios.post(
        `${CONFIG.openai.baseUrl}/chat/completions`,
        {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_completion_tokens: CONFIG.openai.maxTokens,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 120000,
        }
      );

      // Track cost
      const usage = response.data.usage || {};
      this.costTracker.record(model, usage.prompt_tokens || 0, usage.completion_tokens || 0);

      return response.data.choices[0].message.content;
    }, `Codex/${label}`);
  }
}

class ClaudeClient {
  constructor(costTracker) {
    this.apiKey = CONFIG.anthropic.apiKey;
    this.model = CONFIG.anthropic.model;
    this.fallbackModel = CONFIG.anthropic.fallbackModel;
    this.costTracker = costTracker;
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY not set in .env");
  }

  async respondToAudit(code, auditFindings) {
    const systemPrompt = `You are CLAUDE — a senior Web3 developer and builder for MissionChain.
MissionChain is a faith-based Web3 ecosystem on BSC with 10 smart contracts, Next.js DApp, Fastify API.
Key architecture rules:
- ERC20Capped(7B) hard cap, 15% pre-issued in constructor, 85% minted by EmissionController only
- MINTER_ROLE only for EmissionController (never grant to others)
- AccessControl (not Ownable), DEFAULT_ADMIN_ROLE to Gnosis Safe
- SafeERC20 for all token transfers
- ReentrancyGuard on all external call contracts
- USDT has 6 decimals, MIC has 18 decimals — conversion must be explicit
- PancakeSwap V3 TWAP oracle for BNB pricing (no spot price)
- Referral is Pre-Sale ONLY (never on SeedSale)

Codex (the auditor) has reviewed code and found issues. For each finding:
1. Assess if the finding is valid
2. If valid -> propose an exact fix (show old code -> new code)
3. If invalid -> explain why with evidence
4. Rate your confidence (1-10)

Return as structured text:
### Finding: [title]
**Assessment**: VALID / INVALID / PARTIALLY VALID
**Confidence**: X/10
**Response**: [analysis]
**Fix** (if valid): code diff`;

    const userPrompt = `Code under review:\n\`\`\`\n${code}\n\`\`\`\n\nAudit findings:\n${auditFindings}`;

    return this._call(systemPrompt, userPrompt, "audit-response");
  }

  async debateResponse(finding, codexRebuttal, previousContext = "") {
    const systemPrompt = `You are CLAUDE — a senior Web3 developer in a technical debate about MissionChain.
Codex has responded to your proposed fix. Evaluate their rebuttal:
- If they raise valid points -> [ADJUST] your fix
- If you're still correct -> [DEFEND] with evidence
- If they're right -> [CONCEDE] gracefully

Start your response with [ADJUST], [DEFEND], or [CONCEDE]`;

    const userPrompt = previousContext
      ? `Previous context:\n${previousContext}\n\nCodex's latest rebuttal:\n${codexRebuttal}`
      : `Original finding:\n${finding}\n\nCodex's rebuttal:\n${codexRebuttal}`;

    return this._call(systemPrompt, userPrompt, "debate-response");
  }

  async _call(systemPrompt, userPrompt, label = "claude") {
    return withRetry(async (attempt) => {
      const model = attempt >= 2 ? this.fallbackModel : this.model;

      const response = await axios.post(
        `${CONFIG.anthropic.baseUrl}/messages`,
        {
          model,
          max_tokens: CONFIG.anthropic.maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        },
        {
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          timeout: 120000,
        }
      );

      // Track cost
      const usage = response.data.usage || {};
      this.costTracker.record(model, usage.input_tokens || 0, usage.output_tokens || 0);

      return response.data.content[0].text;
    }, `Claude/${label}`);
  }
}

// ============ Gemini Client (Auditor #2) ============

class GeminiClient {
  constructor(costTracker) {
    this.apiKey = CONFIG.google.apiKey;
    this.model = CONFIG.google.model;
    this.fallbackModel = CONFIG.google.fallbackModel;
    this.costTracker = costTracker;
    // Gemini is optional — orchestra still works with Codex + Claude only
    this.enabled = !!this.apiKey;
    if (!this.enabled) {
      console.log("[Gemini] GOOGLE_AI_API_KEY not set — running without Auditor #2");
    }
  }

  async audit(code, context = "") {
    if (!this.enabled) return null;

    const systemInstruction = `You are GEMINI — a senior Web3 architecture reviewer and logic auditor for MissionChain.
MissionChain is a faith-based Web3 ecosystem on Binance Smart Chain (BSC) with:
- 10 Solidity smart contracts (MICToken BEP-20, VestingManager, SeedSale, PreSale, ReferralRegistry, AirdropDistributor, MICELicense ERC-1155, EmissionController, MiningPool, NFTStaking)
- Total supply: 7B MIC (hard cap via ERC20Capped), 15% pre-issued, 85% minted progressively by EmissionController
- Adaptive Emission: E(t) = E_base(t) × D(t) × R(t), E₀ ≈ 22,907,500 MIC/day, T_half = 180 days
- Next.js 14 DApp frontend, Fastify backend API, Prisma ORM, PostgreSQL
- Gnosis Safe 3-of-5 multisig admin, AccessControl (not Ownable)
- PancakeSwap V3 TWAP oracle (primary), Chainlink (fallback)
- MICE License: ERC-1155, 360 days, max 100K, dynamic $300-$1,000
- NFT Staking merged pool (20% emission): MFP×10, Platinum×5, Gold×2.5, Silver×1, No-NFT×0.5

Your role is INDEPENDENT REVIEW — you focus on:
- Architecture & design pattern issues (coupling, modularity, single responsibility)
- Business logic correctness (tokenomics math, vesting schedules, emission formulas)
- State management bugs (race conditions, stale state, inconsistent updates)
- Gas optimization (storage vs memory, loop efficiency, struct packing)
- Integration risks (cross-contract calls, oracle dependency, upgrade compatibility)
- Economic attack vectors (sandwich attacks, MEV, flash loan exploits, price manipulation)
- Data integrity (decimal conversion 6↔18, rounding errors, overflow in token math)
- Error handling completeness (missing reverts, silent failures, unchecked return values)
- Testing coverage gaps (untested edge cases, missing boundary tests)

You review INDEPENDENTLY from Codex (Auditor #1). You may find different issues or agree.

IMPORTANT: Return your findings as a JSON array. Each item must have:
{
  "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
  "title": "Short title",
  "file": "filename or line reference",
  "description": "What's wrong",
  "impact": "What could go wrong",
  "confidence": 8
}

If the code is clean, return: []
Wrap your JSON in \`\`\`json ... \`\`\` markers.`;

    const userPrompt = `${context ? `Context: ${context}\n\n` : ""}Review this code for architecture, logic, and economic correctness:\n\n\`\`\`\n${code}\n\`\`\``;

    return this._call(systemInstruction, userPrompt, "audit");
  }

  async respond(finding, otherResponse, responder = "Claude") {
    if (!this.enabled) return null;

    const systemInstruction = `You are GEMINI — an independent Web3 architecture reviewer in a technical debate about MissionChain code.
${responder} has responded to an audit finding. Evaluate their response:
- If their assessment/fix is correct and complete -> respond with [AGREE]
- If their assessment is partial or misses something -> respond with [PARTIALLY AGREE] + explain gaps
- If their assessment is wrong -> respond with [DISAGREE] + explain why with evidence
- If the original finding was wrong -> respond with [CONCEDE]

Be objective. The goal is correct, secure, economically sound code — not winning.
Start your response with the verdict tag: [AGREE], [PARTIALLY AGREE], [DISAGREE], or [CONCEDE]`;

    const userPrompt = `Original finding:\n${finding}\n\n${responder}'s response:\n${otherResponse}`;

    return this._call(systemInstruction, userPrompt, "debate");
  }

  async _call(systemInstruction, userPrompt, label = "gemini") {
    if (!this.enabled) return null;

    return withRetry(async (attempt) => {
      const model = attempt >= 2 ? this.fallbackModel : this.model;
      const url = `${CONFIG.google.baseUrl}/models/${model}:generateContent?key=${this.apiKey}`;

      const response = await axios.post(url, {
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          maxOutputTokens: CONFIG.google.maxTokens,
          temperature: 0.2,
        },
      }, {
        headers: { "Content-Type": "application/json" },
        timeout: 120000,
      });

      // Track cost — Gemini returns usageMetadata
      const usage = response.data.usageMetadata || {};
      this.costTracker.record(
        model,
        usage.promptTokenCount || 0,
        usage.candidatesTokenCount || 0
      );

      const candidate = response.data.candidates?.[0];
      if (!candidate?.content?.parts?.[0]?.text) {
        throw new Error("Gemini returned empty response");
      }

      return candidate.content.parts[0].text;
    }, `Gemini/${label}`);
  }
}

// ============ Debate Engine (3-Model Tribunal) ============

class DebateEngine {
  constructor(codex, gemini, claude) {
    this.codex = codex;
    this.gemini = gemini;
    this.claude = claude;
    this.debates = [];
  }

  /**
   * Run a 3-model debate on a single audit finding.
   * Flow: Claude proposes fix → Codex + Gemini review in parallel →
   *       Claude synthesizes → repeat until consensus or max rounds →
   *       Claude writes final synthesis report for human decision.
   */
  async runDebate(finding, code) {
    const geminiActive = this.gemini && this.gemini.enabled;
    const debate = {
      finding,
      rounds: [],
      resolution: null,
      consensus: false,
      participants: geminiActive ? ["Codex", "Gemini", "Claude"] : ["Codex", "Claude"],
      synthesis: null,  // Claude's final summary for Thani
      startedAt: new Date().toISOString(),
    };

    console.log(`\n${"=".repeat(60)}`);
    console.log(`  DEBATE (${geminiActive ? "3-MODEL" : "2-MODEL"}): ${finding.substring(0, 70)}...`);
    console.log(`${"=".repeat(60)}`);

    // Round 0: Claude proposes fix
    console.log("\n[Round 0] Claude (Builder) proposes fix...");
    let latestClaudeResponse = await this.claude.respondToAudit(code, finding);
    debate.rounds.push({ round: 0, speaker: "Claude", role: "Builder", content: latestClaudeResponse });
    console.log(`  Claude: ${latestClaudeResponse.substring(0, 200)}...`);

    if (this._extractVerdict(latestClaudeResponse) === "CONCEDE") {
      debate.resolution = "Claude conceded — finding accepted by all";
      debate.consensus = true;
      debate.synthesis = this._quickSynthesis("Claude conceded immediately. The original finding is valid and needs fixing.", finding);
      this.debates.push(debate);
      return debate;
    }

    // Debate rounds — Codex and Gemini review Claude's response
    let debateContext = "";
    for (let round = 1; round <= CONFIG.orchestra.maxDebateRounds; round++) {
      // --- Codex reviews ---
      console.log(`\n[Round ${round}] Codex (Auditor #1) evaluates...`);
      const codexRebuttal = await this.codex.respond(finding, latestClaudeResponse);
      debate.rounds.push({ round, speaker: "Codex", role: "Auditor #1", content: codexRebuttal });
      console.log(`  Codex: ${codexRebuttal.substring(0, 200)}...`);
      const codexVerdict = this._extractVerdict(codexRebuttal);

      // --- Gemini reviews (parallel perspective) ---
      let geminiRebuttal = null;
      let geminiVerdict = null;
      if (geminiActive) {
        console.log(`[Round ${round}] Gemini (Auditor #2) evaluates...`);
        geminiRebuttal = await this.gemini.respond(finding, latestClaudeResponse, "Claude");
        debate.rounds.push({ round, speaker: "Gemini", role: "Auditor #2", content: geminiRebuttal });
        console.log(`  Gemini: ${geminiRebuttal.substring(0, 200)}...`);
        geminiVerdict = this._extractVerdict(geminiRebuttal);
      }

      // --- Check consensus ---
      const verdicts = { codex: codexVerdict, gemini: geminiVerdict };
      const consensusResult = this._checkConsensus(verdicts, geminiActive);

      if (consensusResult.reached) {
        debate.resolution = consensusResult.message;
        debate.consensus = true;
        break;
      }

      // --- Claude synthesizes both rebuttals and responds ---
      console.log(`[Round ${round}] Claude synthesizes and responds...`);
      debateContext += `\n---\nRound ${round} Claude: ${latestClaudeResponse.substring(0, 500)}`;

      const combinedRebuttal = geminiActive
        ? `CODEX (Auditor #1):\n${codexRebuttal}\n\nGEMINI (Auditor #2):\n${geminiRebuttal}`
        : codexRebuttal;

      latestClaudeResponse = await this.claude.debateResponse(
        finding, combinedRebuttal, debateContext
      );
      debate.rounds.push({ round, speaker: "Claude", role: "Synthesizer", content: latestClaudeResponse });
      console.log(`  Claude: ${latestClaudeResponse.substring(0, 200)}...`);

      const claudeVerdict = this._extractVerdict(latestClaudeResponse);
      if (claudeVerdict === "CONCEDE") {
        debate.resolution = "Claude conceded — auditors' finding stands";
        debate.consensus = true;
        break;
      }
    }

    // --- Final Synthesis (always produced for human review) ---
    if (!debate.consensus) {
      debate.resolution = "NO CONSENSUS — Claude synthesis report for human review";
    }

    debate.synthesis = await this._generateSynthesis(debate, finding, code);
    debate.endedAt = new Date().toISOString();
    this.debates.push(debate);
    return debate;
  }

  /**
   * Check if auditors reached consensus
   */
  _checkConsensus(verdicts, geminiActive) {
    const { codex, gemini } = verdicts;

    // Both agree or concede
    if (geminiActive) {
      const bothAgree = (codex === "AGREE" || codex === "CONCEDE") &&
                        (gemini === "AGREE" || gemini === "CONCEDE");
      if (bothAgree) {
        return { reached: true, message: "Both auditors agree with Claude's fix" };
      }
      // One agrees, one partially agrees — soft consensus
      const oneAgrees = (codex === "AGREE" || codex === "CONCEDE" || gemini === "AGREE" || gemini === "CONCEDE");
      const otherPartial = (codex === "PARTIAL" || gemini === "PARTIAL");
      if (oneAgrees && otherPartial) {
        return { reached: true, message: "Soft consensus — one agrees, one partially agrees (minor gaps noted)" };
      }
    } else {
      // 2-model mode
      if (codex === "AGREE" || codex === "CONCEDE") {
        return { reached: true, message: codex === "AGREE" ? "Codex agrees with Claude's fix" : "Codex conceded" };
      }
    }

    return { reached: false };
  }

  /**
   * Claude generates a final synthesis report when there's no full consensus.
   * This is what Thani reads to make the decision.
   */
  async _generateSynthesis(debate, finding, code) {
    const roundSummaries = debate.rounds.map(r =>
      `[${r.speaker} — ${r.role}] (Round ${r.round}):\n${r.content.substring(0, 600)}`
    ).join("\n\n---\n\n");

    const synthesisPrompt = `You are CLAUDE — the orchestra conductor synthesizing a technical debate for MissionChain.

Your job: Write a clear, structured SYNTHESIS REPORT for the project lead (Thani) so he can make the final decision.

The debate involved:
- CODEX (Auditor #1): Security-focused, finds vulnerabilities
- ${debate.participants.includes("Gemini") ? "GEMINI (Auditor #2): Architecture-focused, finds logic/design issues\n- " : ""}CLAUDE (Builder): Proposes fixes, assesses validity

FORMAT YOUR REPORT:
## Finding
[What was found — 1-2 sentences]

## Points of Agreement
[What all parties agree on]

## Points of Disagreement
[Where opinions differ and why — be specific]

## Risk Assessment
[Your assessment: CRITICAL / HIGH / MEDIUM / LOW — with reasoning]

## Recommended Action
[Your recommendation — but the human decides]

## Options for Thani
1. [Option A — accept fix as proposed]
2. [Option B — investigate further]
3. [Option C — dismiss finding]

Be concise. Vietnamese or English — match the conversation language.`;

    const userPrompt = `ORIGINAL FINDING:\n${finding}\n\nDEBATE TRANSCRIPT (${debate.rounds.length} exchanges):\n${roundSummaries}`;

    try {
      return await this.claude._call(synthesisPrompt, userPrompt, "synthesis");
    } catch (err) {
      return this._quickSynthesis(`Synthesis generation failed: ${err.message}. ${debate.rounds.length} debate rounds completed, no consensus.`, finding);
    }
  }

  _quickSynthesis(message, finding) {
    return `## Synthesis\n${message}\n\n## Original Finding\n${finding.substring(0, 300)}`;
  }

  _extractVerdict(text) {
    const upper = text.toUpperCase();
    const verdicts = [
      { tag: "[AGREE]",            key: "AGREE" },
      { tag: "[CONCEDE]",          key: "CONCEDE" },
      { tag: "[PARTIALLY AGREE]",  key: "PARTIAL" },
      { tag: "[DISAGREE]",         key: "DISAGREE" },
      { tag: "[ADJUST]",           key: "ADJUST" },
      { tag: "[DEFEND]",           key: "DEFEND" },
    ];
    for (const v of verdicts) {
      if (upper.startsWith(v.tag) || upper.includes(v.tag)) return v.key;
    }
    return "UNKNOWN";
  }
}

// ============ Orchestra (Main Coordinator) ============

class Orchestra {
  constructor() {
    this.costTracker = new CostTracker();
    this.codex = new CodexClient(this.costTracker);
    this.gemini = new GeminiClient(this.costTracker);
    this.claude = new ClaudeClient(this.costTracker);
    this.debateEngine = new DebateEngine(this.codex, this.gemini, this.claude);
    this.modelPolicy = new ModelPolicy();
    this.results = [];

    if (!fs.existsSync(CONFIG.orchestra.reportDir)) {
      fs.mkdirSync(CONFIG.orchestra.reportDir, { recursive: true });
    }
  }

  /**
   * v2.2: Enforce tribunal policy before any audit.
   * Returns { canProceed, executionMode, missingModels, ... }
   */
  async enforceModelPolicy(founderOverride = null) {
    const result = await this.modelPolicy.enforceTribunalPolicy(founderOverride);
    if (!result.canProceed) {
      console.error(`[Orchestra] MODEL POLICY BLOCK: ${result.message}`);
      console.error(`[Orchestra] Missing models: ${result.missingModels.join(", ")}`);
      console.error(`[Orchestra] Action required: Founder must approve exception or wait for model availability.`);
    }
    return result;
  }

  /**
   * Audit a single file
   */
  async auditFile(filePath) {
    // v2.2: Model policy check — all 3 models required for tribunal
    const policyResult = await this.enforceModelPolicy();
    if (!policyResult.canProceed) {
      throw new Error(`Tribunal model policy: ${policyResult.message}`);
    }
    if (policyResult.executionMode === "exception") {
      console.warn(`[Orchestra] WARNING: Running in EXCEPTION mode. Missing: ${policyResult.missingModels.join(", ")}`);
    }

    // Budget check
    const budget = this.costTracker.canSpend();
    if (!budget.ok) {
      console.error(`[Orchestra] ${budget.reason}`);
      throw new Error(`Budget limit: ${budget.reason}`);
    }

    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`File not found: ${absPath}`);
    }

    const code = fs.readFileSync(absPath, "utf-8");
    const relPath = path.relative(path.join(__dirname, ".."), absPath);

    console.log(`\n${"#".repeat(60)}`);
    console.log(`  ORCHESTRA AUDIT: ${relPath}`);
    console.log(`  Size: ${code.length} chars, ${code.split("\n").length} lines`);
    console.log(`${"#".repeat(60)}`);

    // Step 1: Both auditors run in parallel
    console.log("\n[Step 1] Sending to auditors in parallel...");
    const auditPromises = [
      this.codex.audit(code, `File: ${relPath}`).then(r => { console.log("[Step 1] Codex returned findings"); return r; }),
    ];
    if (this.gemini.enabled) {
      auditPromises.push(
        this.gemini.audit(code, `File: ${relPath}`).then(r => { console.log("[Step 1] Gemini returned findings"); return r; })
      );
    }
    const [codexAudit, geminiAudit = null] = await Promise.all(auditPromises);

    // Step 2: Parse and merge findings from both auditors
    const codexFindings = this._parseFindings(codexAudit).map(f => ({ ...f, source: "Codex" }));
    const geminiFindings = geminiAudit
      ? this._parseFindings(geminiAudit).map(f => ({ ...f, source: "Gemini" }))
      : [];

    const allFindings = [...codexFindings, ...geminiFindings];
    console.log(`[Step 2] Parsed ${codexFindings.length} Codex + ${geminiFindings.length} Gemini = ${allFindings.length} total findings`);

    if (allFindings.length === 0) {
      console.log("  Both auditors agree: file is clean");
      return { file: relPath, findings: [], debates: [], clean: true };
    }

    // Step 3: Claude responds to combined findings
    const combinedAudit = geminiAudit
      ? `=== CODEX (Auditor #1) ===\n${codexAudit}\n\n=== GEMINI (Auditor #2) ===\n${geminiAudit}`
      : codexAudit;
    console.log("\n[Step 3] Claude (Builder) responds to combined audit...");
    const claudeResponse = await this.claude.respondToAudit(code, combinedAudit);

    // Step 4: Debate CRITICAL/HIGH findings (3-model tribunal)
    const debates = [];
    const criticalFindings = allFindings.filter(f => f.severity === "CRITICAL" || f.severity === "HIGH");

    // Deduplicate similar findings from both auditors
    const dedupedFindings = this._deduplicateFindings(criticalFindings);

    for (const finding of dedupedFindings) {
      const budgetCheck = this.costTracker.canSpend();
      if (!budgetCheck.ok) {
        console.log(`[Orchestra] Budget limit reached, skipping remaining debates`);
        break;
      }

      const sources = finding.sources ? finding.sources.join("+") : finding.source;
      console.log(`\n[Step 4] Debating ${finding.severity} (${sources}): ${finding.title}`);
      const debate = await this.debateEngine.runDebate(finding.raw || JSON.stringify(finding), code);
      debates.push(debate);
    }

    const result = {
      file: relPath,
      findings: allFindings,
      codexAudit,
      geminiAudit,
      claudeResponse,
      debates,
      clean: false,
      timestamp: new Date().toISOString(),
      cost: this.costTracker.summary(),
    };

    this.results.push(result);
    return result;
  }

  /**
   * Audit multiple files in a directory
   */
  async auditDirectory(dirPath, extensions = [".js", ".ts", ".sol", ".tsx", ".jsx"]) {
    const absDir = path.resolve(dirPath);
    const files = this._walkDir(absDir, extensions);
    console.log(`\nFound ${files.length} files to audit in ${dirPath}`);

    const results = [];
    for (const file of files) {
      const budget = this.costTracker.canSpend();
      if (!budget.ok) {
        console.log(`[Orchestra] Budget limit reached: ${budget.reason}`);
        break;
      }
      try {
        const result = await this.auditFile(file);
        results.push(result);
      } catch (err) {
        console.error(`Error auditing ${file}: ${err.message}`);
        results.push({ file, error: err.message });
      }
    }
    return results;
  }

  /**
   * Audit specific phase files — MissionChain codebase structure
   */
  async auditPhase(phaseName) {
    const phases = {
      // ---- Smart Contracts (Solidity) ----
      contracts: [
        "missionchain_app/packages/contracts/contracts/MICToken.sol",
        "missionchain_app/packages/contracts/contracts/VestingManager.sol",
        "missionchain_app/packages/contracts/contracts/SeedSale.sol",
        "missionchain_app/packages/contracts/contracts/ReferralRegistry.sol",
        "missionchain_app/packages/contracts/contracts/PreSale.sol",
        "missionchain_app/packages/contracts/contracts/AirdropDistributor.sol",
        "missionchain_app/packages/contracts/contracts/MICELicense.sol",
        "missionchain_app/packages/contracts/contracts/EmissionController.sol",
        "missionchain_app/packages/contracts/contracts/MiningPool.sol",
        "missionchain_app/packages/contracts/contracts/NFTStaking.sol",
      ],
      // ---- Contract Tests ----
      "contract-tests": [
        "missionchain_app/packages/contracts/test/MICToken.test.ts",
        "missionchain_app/packages/contracts/test/SeedSale.test.ts",
        "missionchain_app/packages/contracts/test/PreSale.test.ts",
        "missionchain_app/packages/contracts/test/EmissionController.test.ts",
        "missionchain_app/packages/contracts/test/MICELicense.test.ts",
        "missionchain_app/packages/contracts/test/NFTStaking.test.ts",
      ],
      // ---- Deploy Scripts ----
      deploy: [
        "missionchain_app/packages/contracts/scripts/deploy-testnet.ts",
        "missionchain_app/packages/contracts/scripts/deploy-mainnet.ts",
      ],
      // ---- Shared SDK ----
      sdk: [
        "missionchain_app/packages/sdk/src/constants.ts",
        "missionchain_app/packages/sdk/src/types.ts",
        "missionchain_app/packages/sdk/src/abis/index.ts",
      ],
      // ---- Database (Prisma) ----
      db: [
        "missionchain_app/packages/db/prisma/schema.prisma",
      ],
      // ---- Backend API (Fastify) ----
      api: [
        "missionchain_app/apps/api/src/server.ts",
        "missionchain_app/apps/api/src/routes/auth.ts",
        "missionchain_app/apps/api/src/routes/user.ts",
        "missionchain_app/apps/api/src/routes/admin.ts",
        "missionchain_app/apps/api/src/routes/kyc.ts",
        "missionchain_app/apps/api/src/routes/notification.ts",
        "missionchain_app/apps/api/src/middleware/auth.ts",
        "missionchain_app/apps/api/src/middleware/rbac.ts",
        "missionchain_app/apps/api/src/services/emission.ts",
        "missionchain_app/apps/api/src/services/vesting.ts",
      ],
      // ---- DApp Frontend (Next.js — missionchain.io) ----
      web: [
        "missionchain_app/apps/web/src/app/layout.tsx",
        "missionchain_app/apps/web/src/app/page.tsx",
        "missionchain_app/apps/web/src/components/WalletConnect.tsx",
        "missionchain_app/apps/web/src/components/StakingPanel.tsx",
        "missionchain_app/apps/web/src/components/MiningDashboard.tsx",
        "missionchain_app/apps/web/src/components/SeedSalePanel.tsx",
        "missionchain_app/apps/web/src/components/PreSalePanel.tsx",
        "missionchain_app/apps/web/src/components/VestingSchedule.tsx",
        "missionchain_app/apps/web/src/hooks/useContract.ts",
        "missionchain_app/apps/web/src/hooks/useEmission.ts",
      ],
      // ---- Public Info Site (missionchain.info) ----
      info: [
        "missionchain_info/index.html",
        "missionchain_info/frontend/dapp/missionchain-dapp.html",
        "missionchain_info/frontend/documents/whitepaper.html",
        "missionchain_info/frontend/documents/documents-index.html",
      ],
      // ---- Community Platform (missionchain.world) ----
      world: [
        "missionchain_world/apps/web/src/app/layout.tsx",
        "missionchain_world/apps/web/src/app/page.tsx",
        "missionchain_world/apps/web/src/components/SophiaWord.tsx",
        "missionchain_world/apps/web/src/components/Challenges.tsx",
      ],
      // ---- Orchestra self-audit ----
      orchestra: [
        "mic-orchestra/orchestra.js",
        "mic-orchestra/nlp-commander.js",
        "mic-orchestra/ops-commander.js",
        "mic-orchestra/admin-ai-assistant.js",
        "mic-orchestra/admin-config.js",
        "mic-orchestra/scheduler.js",
        "mic-orchestra/telegram-bridge.js",
      ],
      // ---- Full audit: contracts + API + web (production-critical) ----
      full: [
        // All 10 contracts
        "missionchain_app/packages/contracts/contracts/MICToken.sol",
        "missionchain_app/packages/contracts/contracts/VestingManager.sol",
        "missionchain_app/packages/contracts/contracts/SeedSale.sol",
        "missionchain_app/packages/contracts/contracts/ReferralRegistry.sol",
        "missionchain_app/packages/contracts/contracts/PreSale.sol",
        "missionchain_app/packages/contracts/contracts/AirdropDistributor.sol",
        "missionchain_app/packages/contracts/contracts/MICELicense.sol",
        "missionchain_app/packages/contracts/contracts/EmissionController.sol",
        "missionchain_app/packages/contracts/contracts/MiningPool.sol",
        "missionchain_app/packages/contracts/contracts/NFTStaking.sol",
        // API critical routes
        "missionchain_app/apps/api/src/server.ts",
        "missionchain_app/apps/api/src/routes/auth.ts",
        "missionchain_app/apps/api/src/middleware/auth.ts",
        "missionchain_app/apps/api/src/middleware/rbac.ts",
        "missionchain_app/apps/api/src/services/emission.ts",
        // DApp critical components
        "missionchain_app/apps/web/src/hooks/useContract.ts",
        "missionchain_app/apps/web/src/components/WalletConnect.tsx",
      ],
    };

    const phaseFiles = phases[phaseName];
    if (!phaseFiles) {
      throw new Error(`Unknown phase: ${phaseName}. Available: ${Object.keys(phases).join(", ")}`);
    }

    const baseDir = path.join(__dirname, "..");

    // Pre-check: count how many files actually exist
    const existing = phaseFiles.filter(f => fs.existsSync(path.join(baseDir, f)));
    const missing = phaseFiles.length - existing.length;

    console.log(`\nAuditing phase: ${phaseName} (${existing.length}/${phaseFiles.length} files found)`);
    if (missing > 0) {
      console.log(`  ⚠ ${missing} file(s) not yet in workspace — codebase not fully deployed for this phase`);
    }
    if (existing.length === 0) {
      console.log(`  ✗ Phase "${phaseName}" has NO files in workspace yet — skipping entirely`);
      return [{ file: `phase:${phaseName}`, error: `Phase not ready: 0/${phaseFiles.length} files exist in workspace. Deploy codebase first.` }];
    }

    const results = [];
    for (const file of phaseFiles) {
      const fullPath = path.join(baseDir, file);
      if (fs.existsSync(fullPath)) {
        const budget = this.costTracker.canSpend();
        if (!budget.ok) {
          console.log(`[Orchestra] Budget limit: ${budget.reason}`);
          results.push({ file, error: budget.reason });
          break;
        }
        const result = await this.auditFile(fullPath);
        results.push(result);
      } else {
        results.push({ file, error: "Not yet deployed", skipped: true });
      }
    }
    return results;
  }

  /**
   * Generate unified report
   */
  generateReport(results, title = "MissionChain AI Orchestra Audit Report") {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    const reportName = `orchestra-report-${timestamp}.md`;
    const reportPath = path.join(CONFIG.orchestra.reportDir, reportName);

    const geminiEnabled = this.gemini && this.gemini.enabled;
    let report = `# ${title}\n`;
    report += `**Generated**: ${new Date().toISOString()}\n`;
    report += `**Auditor #1**: Codex (${CONFIG.openai.model})\n`;
    if (geminiEnabled) report += `**Auditor #2**: Gemini (${CONFIG.google.model})\n`;
    report += `**Builder & Synthesizer**: Claude (${CONFIG.anthropic.model})\n`;
    report += `**Mode**: ${geminiEnabled ? "3-Model Tribunal" : "2-Model (Gemini not configured)"}\n`;
    report += `**Files Audited**: ${results.length}\n`;
    report += `**Project**: MissionChain — Faith-based Web3 Ecosystem on BSC\n\n`;

    // Summary stats
    let totalFindings = 0, criticals = 0, highs = 0, consensusCount = 0, escalatedCount = 0;
    for (const r of results) {
      if (r.error) continue;
      totalFindings += (r.findings?.length || 0);
      criticals += (r.findings?.filter(f => f.severity === "CRITICAL").length || 0);
      highs += (r.findings?.filter(f => f.severity === "HIGH").length || 0);
      consensusCount += (r.debates?.filter(d => d.consensus).length || 0);
      escalatedCount += (r.debates?.filter(d => !d.consensus).length || 0);
    }

    report += `## Summary\n\n`;
    report += `| Metric | Count |\n|--------|-------|\n`;
    report += `| Total Findings | ${totalFindings} |\n`;
    report += `| Critical | ${criticals} |\n`;
    report += `| High | ${highs} |\n`;
    report += `| Debates Resolved | ${consensusCount} |\n`;
    report += `| Escalated to Human | ${escalatedCount} |\n\n`;

    // Cost summary
    const cost = this.costTracker.summary();
    report += `## Cost\n\n`;
    report += `| Period | Spent | Budget |\n|--------|-------|--------|\n`;
    report += `| Today | $${cost.today} | $${cost.dailyBudget} |\n`;
    report += `| This Month | $${cost.thisMonth} | $${cost.monthlyBudget} |\n\n`;

    // Per-file details
    for (const r of results) {
      report += `---\n\n## ${r.file}\n\n`;
      if (r.error) {
        report += `**Error**: ${r.error}\n\n`;
        continue;
      }
      if (r.clean) {
        report += `**Clean** — No issues found\n\n`;
        continue;
      }
      report += `### Findings (${r.findings?.length || 0})\n\n`;
      for (const f of (r.findings || [])) {
        const src = f.sources ? f.sources.join("+") : (f.source || "?");
        report += `- **[${f.severity}]** ${f.title || "Untitled"} _(by ${src}, confidence: ${f.confidence || "?"})_\n`;
        if (f.description) report += `  ${f.description}\n`;
      }
      report += `\n`;

      if (r.debates && r.debates.length > 0) {
        report += `### Debate Outcomes\n\n`;
        for (const d of r.debates) {
          report += `**Finding**: ${d.finding.substring(0, 100)}...\n`;
          report += `**Participants**: ${(d.participants || ["Codex", "Claude"]).join(", ")}\n`;
          report += `**Rounds**: ${d.rounds.length}\n`;
          report += `**Resolution**: ${d.resolution}\n`;
          report += `**Consensus**: ${d.consensus ? "Yes" : "No — needs human review"}\n`;
          if (d.synthesis && !d.consensus) {
            report += `\n**Claude's Synthesis for Review:**\n${d.synthesis}\n`;
          }
          report += `\n`;
        }
      }
    }

    // Action items
    report += `---\n\n## Action Items\n\n`;
    let actionNum = 1;
    for (const r of results) {
      if (r.error || r.clean) continue;
      for (const d of (r.debates || [])) {
        if (d.consensus) {
          report += `${actionNum}. **RECOMMENDED FIX** (consensus reached): ${d.resolution} — ${r.file}\n`;
        } else {
          report += `${actionNum}. **NEEDS DECISION** (no consensus): ${d.resolution} — ${r.file}\n`;
        }
        actionNum++;
      }
    }
    if (actionNum === 1) report += `No action items.\n`;

    fs.writeFileSync(reportPath, report);
    console.log(`\nReport saved: ${reportPath}`);
    return { path: reportPath, content: report };
  }

  /**
   * Send summary to Telegram
   */
  async notifyTelegram(report, results) {
    if (!CONFIG.telegram.botToken || !CONFIG.telegram.chatId) {
      console.log("[Orchestra] Telegram not configured — skipping");
      return;
    }

    const totalFindings = results.reduce((s, r) => s + (r.findings?.length || 0), 0);
    const criticals = results.reduce((s, r) =>
      s + (r.findings?.filter(f => f.severity === "CRITICAL").length || 0), 0);
    const escalated = results.reduce((s, r) =>
      s + (r.debates?.filter(d => !d.consensus).length || 0), 0);
    const cost = this.costTracker.summary();

    const geminiEnabled = this.gemini && this.gemini.enabled;
    let msg = `<b>MissionChain AI Orchestra Report</b>\n`;
    msg += `<i>${geminiEnabled ? "3-Model Tribunal: Codex + Gemini + Claude" : "2-Model: Codex + Claude"}</i>\n\n`;
    msg += `Files: ${results.length}\n`;
    msg += `Findings: ${totalFindings}\n`;
    msg += `Critical: ${criticals}\n`;
    msg += `Debates resolved: ${results.reduce((s, r) => s + (r.debates?.filter(d => d.consensus).length || 0), 0)}\n`;
    msg += `Needs review: ${escalated}\n`;
    msg += `Cost: $${cost.today} today / $${cost.thisMonth} month\n\n`;

    if (escalated > 0) {
      msg += `<b>Action needed:</b> ${escalated} finding(s) need your review.`;
    } else if (totalFindings === 0) {
      msg += `All files clean!`;
    } else {
      msg += `All findings have recommended fixes (consensus reached — pending your approval).`;
    }

    try {
      const TelegramBot = require("node-telegram-bot-api");
      const bot = new TelegramBot(CONFIG.telegram.botToken, { polling: false });
      await bot.sendMessage(CONFIG.telegram.chatId, msg, { parse_mode: "HTML" });
      console.log("[Orchestra] Telegram notification sent");
    } catch (err) {
      console.error(`[Orchestra] Telegram failed: ${err.message}`);
    }
  }

  // ============ Readiness Check ============

  /**
   * Check which phases have files present in workspace.
   * Returns readiness status for Telegram /status or dashboard display.
   */
  checkReadiness() {
    const baseDir = path.join(__dirname, "..");
    const phases = this._getPhaseMap();
    const report = {};

    for (const [name, files] of Object.entries(phases)) {
      const existing = files.filter(f => fs.existsSync(path.join(baseDir, f)));
      report[name] = {
        total: files.length,
        found: existing.length,
        ready: existing.length > 0,
        percentage: Math.round((existing.length / files.length) * 100),
      };
    }

    return {
      phases: report,
      geminiEnabled: this.gemini?.enabled || false,
      mode: this.gemini?.enabled ? "3-Model Tribunal" : "2-Model (Codex + Claude)",
      readyPhases: Object.entries(report).filter(([_, v]) => v.ready).map(([k]) => k),
      notReadyPhases: Object.entries(report).filter(([_, v]) => !v.ready).map(([k]) => k),
    };
  }

  /** Extract phase map (reusable) */
  _getPhaseMap() {
    // Same map as auditPhase — extracted for reuse
    return {
      contracts: ["missionchain_app/packages/contracts/contracts/MICToken.sol"],
      api: ["missionchain_app/apps/api/src/server.ts"],
      web: ["missionchain_app/apps/web/src/app/layout.tsx"],
      info: [
        "missionchain_info/index.html",
        "missionchain_info/frontend/dapp/missionchain-dapp.html",
        "missionchain_info/frontend/documents/whitepaper.html",
        "missionchain_info/frontend/documents/documents-index.html",
      ],
      world: ["missionchain_world/apps/web/src/app/layout.tsx"],
      orchestra: [
        "mic-orchestra/orchestra.js",
        "mic-orchestra/nlp-commander.js",
        "mic-orchestra/ops-commander.js",
        "mic-orchestra/admin-ai-assistant.js",
        "mic-orchestra/admin-config.js",
        "mic-orchestra/scheduler.js",
        "mic-orchestra/telegram-bridge.js",
      ],
    };
  }

  // ============ Helpers ============

  /**
   * Parse findings — supports both JSON and legacy text format
   */
  _parseFindings(auditText) {
    // Try JSON first (new structured format)
    const jsonMatch = auditText.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed)) {
          return parsed.map(f => ({
            severity: (f.severity || "INFO").toUpperCase(),
            title: f.title || "Untitled",
            description: f.description || "",
            impact: f.impact || "",
            confidence: f.confidence || 5,
            raw: JSON.stringify(f),
          }));
        }
      } catch (e) {
        console.log("[Orchestra] JSON parse failed, falling back to text parsing");
      }
    }

    // Fallback: text-based parsing (legacy)
    const findings = [];
    const sections = auditText.split(/(?=\b(?:CRITICAL|HIGH|MEDIUM|LOW|INFO)\b)/i);
    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/\b(CRITICAL|HIGH|MEDIUM|LOW|INFO)\b/i);
      if (match) {
        findings.push({
          severity: match[0].toUpperCase(),
          title: trimmed.split("\n")[0].substring(0, 120),
          description: trimmed,
          raw: trimmed,
          confidence: 5,
        });
      }
    }
    return findings;
  }

  /**
   * Deduplicate similar findings from Codex and Gemini.
   * If both auditors flag the same issue, merge into one with higher severity.
   */
  _deduplicateFindings(findings) {
    const deduped = [];
    const used = new Set();

    for (let i = 0; i < findings.length; i++) {
      if (used.has(i)) continue;
      const f = { ...findings[i], sources: [findings[i].source] };

      // Check if another finding is similar (same file area + similar title)
      for (let j = i + 1; j < findings.length; j++) {
        if (used.has(j)) continue;
        if (findings[i].source === findings[j].source) continue; // Same auditor, keep separate
        if (this._isSimilarFinding(findings[i], findings[j])) {
          f.sources.push(findings[j].source);
          // Elevate: if both auditors flag it, keep the higher severity
          const sevOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
          if ((sevOrder[findings[j].severity] || 0) > (sevOrder[f.severity] || 0)) {
            f.severity = findings[j].severity;
          }
          used.add(j);
        }
      }

      deduped.push(f);
      used.add(i);
    }

    return deduped;
  }

  _isSimilarFinding(a, b) {
    // Simple heuristic: same severity level and overlapping title keywords
    const wordsA = (a.title || "").toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const wordsB = (b.title || "").toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const overlap = wordsA.filter(w => wordsB.includes(w));
    return overlap.length >= 2;  // At least 2 significant words in common
  }

  _walkDir(dir, extensions) {
    const files = [];
    const skip = ["node_modules", ".git", "artifacts", "cache", "reports", ".next", "dist", "build", "coverage"];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (skip.includes(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...this._walkDir(fullPath, extensions));
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch (err) {
      console.error(`Error walking ${dir}: ${err.message}`);
    }
    return files;
  }
}

// ============ CLI ============

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const target = args[1];

  if (!command) {
    console.log(`
MissionChain AI Orchestra v4.0 (3-Model Tribunal) — Usage:
  node orchestra.js audit <file>         Audit a single file
  node orchestra.js audit-dir <dir>      Audit all files in directory
  node orchestra.js phase <name>         Audit a predefined phase
                                         Phases: contracts, contract-tests, deploy,
                                                 sdk, db, api, web, info, world,
                                                 orchestra, full
  node orchestra.js debate <topic>       Run a focused debate on a topic
  node orchestra.js full-audit           Audit the entire project
  node orchestra.js cost-report          Show cost tracking summary
    `);
    process.exit(0);
  }

  // Cost report doesn't need API keys
  if (command === "cost-report") {
    const tracker = new CostTracker();
    const summary = tracker.summary();
    console.log("\n=== MissionChain Orchestra Cost Report ===");
    console.log(`Today:      $${summary.today}`);
    console.log(`This Month: $${summary.thisMonth}`);
    console.log(`All Time:   $${summary.allTime}`);
    console.log(`API Calls:  ${summary.totalCalls}`);
    console.log(`Daily Budget:   $${summary.dailyBudget}`);
    console.log(`Monthly Budget: $${summary.monthlyBudget}`);
    process.exit(0);
  }

  const orchestra = new Orchestra();

  try {
    let results;

    switch (command) {
      case "audit":
        if (!target) throw new Error("Specify a file to audit");
        results = [await orchestra.auditFile(target)];
        break;

      case "audit-dir":
        results = await orchestra.auditDirectory(target || ".");
        break;

      case "phase":
        if (!target) throw new Error("Specify phase: contracts, contract-tests, deploy, sdk, db, api, web, info, world, orchestra, full");
        results = await orchestra.auditPhase(target);
        break;

      case "full-audit":
        results = await orchestra.auditDirectory(path.join(__dirname, ".."));
        break;

      case "debate": {
        if (!target) throw new Error("Specify a topic or file");
        const code = fs.existsSync(target) ? fs.readFileSync(target, "utf-8") : "";
        const topic = fs.existsSync(target) ? `Full review of ${target}` : target;
        const debate = await orchestra.debateEngine.runDebate(`Debate topic: ${topic}`, code || topic);
        results = [{ file: "debate", findings: [{ severity: "INFO", raw: topic }], debates: [debate], clean: false }];
        break;
      }

      default:
        throw new Error(`Unknown command: ${command}`);
    }

    const report = orchestra.generateReport(results);
    await orchestra.notifyTelegram(report, results);

    console.log("\nOrchestra audit complete!");
    console.log(`Report: ${report.path}`);
    console.log(`Cost today: $${orchestra.costTracker.summary().today}`);

  } catch (err) {
    console.error(`\nOrchestra error: ${err.message}`);
    process.exit(1);
  }
}

// ============ Exports ============

module.exports = { Orchestra, CodexClient, GeminiClient, ClaudeClient, DebateEngine, CostTracker, CONFIG };

// ============ Run ============

if (require.main === module) {
  main().catch(err => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
