/**
 * ============================================================
 *  MissionChain — Model Policy v2.2
 *  Enforces tribunal requirements per AI Team Workflow spec.
 *
 *  RULES:
 *  1. Model #2 (Gemini) BAT BUOC cho tribunal chinh thuc
 *  2. Orchestra KHONG duoc tu ha xuong 2-model mode
 *  3. Neu thieu model -> DUNG -> bao Founder -> cho quyet dinh
 *  4. Neu Founder cho phep exception -> gan nhan exception_mode
 * ============================================================
 */

require("dotenv").config({ path: require("path").join(__dirname, ".env"), override: true });
const https = require("https");
const http = require("http");

// ─── Cache for ping results (60 second TTL) ───
const CACHE_TTL_MS = 60_000;
let _cache = { timestamp: 0, results: null };

class ModelPolicy {
  constructor() {
    this.config = {
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || "",
        model: process.env.CLAUDE_PRIMARY_MODEL || "claude-sonnet-4-20250514",
        endpoint: "https://api.anthropic.com/v1/messages",
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY || "",
        model: process.env.OPENAI_PRIMARY_MODEL || "o1",
        endpoint: "https://api.openai.com/v1/chat/completions",
      },
      google: {
        apiKey: process.env.GOOGLE_AI_API_KEY || "",
        model: process.env.GEMINI_PRIMARY_MODEL || "gemini-2.5-flash",
        endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
      },
    };
  }

  /**
   * Ping a single model provider with a minimal request to verify key + connectivity.
   * Does NOT count towards budget — uses smallest possible request.
   * @param {'anthropic'|'openai'|'google'} provider
   * @returns {Promise<{status: 'ok'|'unavailable'|'no_key', model: string, latency_ms: number, error?: string}>}
   */
  async pingModel(provider) {
    const cfg = this.config[provider];
    if (!cfg || !cfg.apiKey) {
      return { status: "no_key", model: cfg?.model || "unknown", latency_ms: 0, error: "API key not configured" };
    }

    const start = Date.now();

    try {
      if (provider === "anthropic") {
        await this._pingAnthropic(cfg);
      } else if (provider === "openai") {
        await this._pingOpenAI(cfg);
      } else if (provider === "google") {
        await this._pingGoogle(cfg);
      }
      return { status: "ok", model: cfg.model, latency_ms: Date.now() - start };
    } catch (err) {
      return { status: "unavailable", model: cfg.model, latency_ms: Date.now() - start, error: err.message };
    }
  }

  /**
   * Check all 3 models. Returns cached result if within TTL.
   */
  async checkAllModels() {
    // Return cache if fresh
    if (_cache.results && (Date.now() - _cache.timestamp) < CACHE_TTL_MS) {
      return _cache.results;
    }

    const [claude, codex, gemini] = await Promise.all([
      this.pingModel("anthropic"),
      this.pingModel("openai"),
      this.pingModel("google"),
    ]);

    const tribunalReady =
      claude.status === "ok" &&
      codex.status === "ok" &&
      gemini.status === "ok";

    const results = {
      claude,
      codex,
      gemini,
      tribunal_ready: tribunalReady,
      reason: tribunalReady ? null : this._getMissingReason({ claude, codex, gemini }),
      checked_at: new Date().toISOString(),
    };

    // Update cache
    _cache = { timestamp: Date.now(), results };
    return results;
  }

  /**
   * Enforce tribunal policy. Called before every pipeline run.
   * @param {object|null} founderOverride — { reason: string } if Founder allows exception
   * @returns {Promise<{canProceed: boolean, executionMode: string|null, missingModels: string[], ...}>}
   */
  async enforceTribunalPolicy(founderOverride = null) {
    const check = await this.checkAllModels();

    if (check.tribunal_ready) {
      return {
        canProceed: true,
        executionMode: "normal",
        missingModels: [],
        modelVersions: {
          claude: check.claude.model,
          codex: check.codex.model,
          gemini: check.gemini.model,
        },
      };
    }

    const missingModels = this._getMissingModels(check);

    // KHONG DUOC tu tiep tuc. Phai bao Founder.
    if (!founderOverride) {
      return {
        canProceed: false,
        executionMode: null,
        missingModels,
        action: "ESCALATION_REPORT",
        message: `Thieu model bat buoc cho tribunal: ${missingModels.join(", ")}. Can Founder quyet dinh.`,
      };
    }

    // Founder da cho phep exception mode
    return {
      canProceed: true,
      executionMode: "exception",
      missingModels,
      founderOverride: true,
      founderOverrideReason: founderOverride.reason || "Founder approved exception",
      modelVersions: {
        claude: check.claude.model,
        codex: check.codex.model,
        gemini: check.gemini.model,
      },
    };
  }

  /**
   * KHONG BAO GIO goi method nay tu dong.
   * Chi su dung khi Founder TUONG MINH cho phep.
   */
  _dangerousAllowDegradedMode() {
    throw new Error(
      "KHONG DUOC tu ha mode. Goi enforceTribunalPolicy(founderOverride) thay vi ham nay."
    );
  }

  /**
   * Invalidate the cache (e.g. after config change).
   */
  clearCache() {
    _cache = { timestamp: 0, results: null };
  }

  // ─── Private: Ping Implementations ───

  async _pingAnthropic(cfg) {
    return this._httpPost(cfg.endpoint, {
      model: cfg.model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }, {
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
  }

  async _pingOpenAI(cfg) {
    // Use a lightweight model for ping if primary is expensive
    const pingModel = cfg.model === "o1" ? "gpt-4o-mini" : cfg.model;
    return this._httpPost(cfg.endpoint, {
      model: pingModel,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }, {
      "Authorization": `Bearer ${cfg.apiKey}`,
      "content-type": "application/json",
    });
  }

  async _pingGoogle(cfg) {
    // Google AI: use generateContent with minimal input
    const url = `${cfg.endpoint}/${cfg.model}:generateContent?key=${cfg.apiKey}`;
    return this._httpPost(url, {
      contents: [{ parts: [{ text: "ping" }] }],
      generationConfig: { maxOutputTokens: 1 },
    }, {
      "content-type": "application/json",
    });
  }

  /**
   * Generic HTTPS POST with timeout.
   */
  _httpPost(url, body, headers) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const postData = JSON.stringify(body);

      const req = https.request({
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          ...headers,
          "content-length": Buffer.byteLength(postData),
        },
        timeout: 15000,
      }, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 500) {
            // 4xx = key issue but service reachable. 2xx = ok.
            // We accept both as "service reachable" for ping.
            // Only 5xx or network errors count as "unavailable".
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else if (res.statusCode === 401 || res.statusCode === 403) {
              reject(new Error(`Auth failed (${res.statusCode}): Invalid API key`));
            } else {
              resolve(data); // 4xx other = service reachable
            }
          } else {
            reject(new Error(`Server error ${res.statusCode}`));
          }
        });
      });

      req.on("error", err => reject(err));
      req.on("timeout", () => { req.destroy(); reject(new Error("Timeout (15s)")); });
      req.write(postData);
      req.end();
    });
  }

  // ─── Private: Helpers ───

  _getMissingModels(check) {
    const missing = [];
    if (check.claude.status !== "ok") missing.push(`Claude (${check.claude.model})`);
    if (check.codex.status !== "ok") missing.push(`Codex (${check.codex.model})`);
    if (check.gemini.status !== "ok") missing.push(`Gemini (${check.gemini.model})`);
    return missing;
  }

  _getMissingReason(check) {
    const parts = [];
    if (check.claude.status !== "ok") parts.push(`Claude: ${check.claude.error || check.claude.status}`);
    if (check.codex.status !== "ok") parts.push(`Codex: ${check.codex.error || check.codex.status}`);
    if (check.gemini.status !== "ok") parts.push(`Gemini: ${check.gemini.error || check.gemini.status}`);
    return parts.join("; ");
  }
}

module.exports = ModelPolicy;
