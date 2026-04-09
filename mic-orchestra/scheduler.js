/**
 * ============================================================
 *  MissionChain — Orchestra Scheduler v4.0
 *  Automated scheduling for periodic audits (3-Model Tribunal)
 *  Updated: phase names match MissionChain codebase structure
 *           + budget-aware scheduling + Gemini Auditor #2
 * ============================================================
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), override: true });
const cron = require("node-cron");
const path = require("path");
const { Orchestra } = require("./orchestra");

// ============ Config ============

const SCHEDULE = {
  // Daily smart contract audit at 6:00 AM UTC
  contractAudit: process.env.ORCHESTRA_CONTRACT_CRON || "0 6 * * *",

  // API security check every 6 hours
  apiSecurityCheck: process.env.ORCHESTRA_API_CRON || "0 */6 * * *",

  // Weekly full audit — Sunday 2:00 AM UTC
  weeklyFullAudit: process.env.ORCHESTRA_FULL_CRON || "0 2 * * 0",

  // DApp frontend audit — Wednesday 3:00 AM UTC
  frontendAudit: process.env.ORCHESTRA_FRONTEND_CRON || "0 3 * * 3",
};

// ============ Scheduler ============

class OrchestraScheduler {
  constructor() {
    this.orchestra = null; // Lazy init — only create when starting
    this.jobs = [];
    this.running = false;
    this.lastRun = {};
  }

  start() {
    if (this.running) {
      console.log("[Scheduler] Already running");
      return;
    }

    // Lazy init Orchestra (validates API keys)
    try {
      this.orchestra = new Orchestra();
    } catch (err) {
      console.error(`[Scheduler] Cannot start — ${err.message}`);
      return;
    }

    console.log("============================================");
    console.log("  MissionChain AI Orchestra Scheduler v4.0");
    console.log("============================================\n");

    // Daily: audit all 10 smart contracts (highest priority — security-critical)
    if (cron.validate(SCHEDULE.contractAudit)) {
      const job = cron.schedule(SCHEDULE.contractAudit, async () => {
        console.log("\n[Scheduler] Running daily smart contracts audit...");
        await this._runAudit("contracts", "Daily Smart Contracts Audit");
      });
      this.jobs.push({ name: "daily-contracts", job, cron: SCHEDULE.contractAudit });
      console.log(`  Contract audit:  ${SCHEDULE.contractAudit}`);
    }

    // Every 6h: API security check (auth, RBAC, input validation)
    if (cron.validate(SCHEDULE.apiSecurityCheck)) {
      const job = cron.schedule(SCHEDULE.apiSecurityCheck, async () => {
        console.log("\n[Scheduler] Running API security check...");
        await this._runAudit("api", "Periodic API Security Check");
      });
      this.jobs.push({ name: "api-security", job, cron: SCHEDULE.apiSecurityCheck });
      console.log(`  API security:    ${SCHEDULE.apiSecurityCheck}`);
    }

    // Weekly: full production audit (contracts + API + web)
    if (cron.validate(SCHEDULE.weeklyFullAudit)) {
      const job = cron.schedule(SCHEDULE.weeklyFullAudit, async () => {
        console.log("\n[Scheduler] Running weekly full production audit...");
        await this._runAudit("full", "Weekly Full Production Audit");
      });
      this.jobs.push({ name: "weekly-full", job, cron: SCHEDULE.weeklyFullAudit });
      console.log(`  Weekly full:     ${SCHEDULE.weeklyFullAudit}`);
    }

    // Mid-week: DApp frontend audit
    if (cron.validate(SCHEDULE.frontendAudit)) {
      const job = cron.schedule(SCHEDULE.frontendAudit, async () => {
        console.log("\n[Scheduler] Running DApp frontend audit...");
        await this._runAudit("web", "Mid-Week DApp Frontend Audit");
      });
      this.jobs.push({ name: "frontend-audit", job, cron: SCHEDULE.frontendAudit });
      console.log(`  Frontend audit:  ${SCHEDULE.frontendAudit}`);
    }

    console.log(`\nScheduler running with ${this.jobs.length} jobs.`);
    this.running = true;
  }

  async _runAudit(phase, title) {
    // Cooldown: skip if same phase ran < 5 min ago
    if (this.lastRun[phase] && Date.now() - this.lastRun[phase] < 300000) {
      console.log(`[Scheduler] Skipping ${phase} — ran less than 5 minutes ago`);
      return;
    }

    this.lastRun[phase] = Date.now();

    try {
      // Budget check before running
      const budget = this.orchestra.costTracker.canSpend();
      if (!budget.ok) {
        console.log(`[Scheduler] ${title} skipped — ${budget.reason}`);
        return;
      }

      const results = await this.orchestra.auditPhase(phase);
      const report = this.orchestra.generateReport(results, title);
      await this.orchestra.notifyTelegram(report, results);
      console.log(`[Scheduler] ${title} complete — ${results.length} files audited`);
    } catch (err) {
      console.error(`[Scheduler] ${title} failed: ${err.message}`);
    }
  }

  /** Run a one-off audit (for Telegram commands) */
  async runOnDemand(phase, title) {
    if (!this.orchestra) {
      this.orchestra = new Orchestra();
    }
    return this._runAudit(phase, title);
  }

  stop() {
    for (const { name, job } of this.jobs) {
      job.stop();
      console.log(`Stopped job: ${name}`);
    }
    this.jobs = [];
    this.running = false;
  }

  status() {
    return {
      running: this.running,
      jobs: this.jobs.map(j => ({ name: j.name, cron: j.cron })),
      lastRun: this.lastRun,
      cost: this.orchestra?.costTracker?.summary() || null,
    };
  }
}

// ============ Main ============

if (require.main === module) {
  const scheduler = new OrchestraScheduler();
  scheduler.start();

  process.on("SIGINT", () => {
    console.log("\n[Scheduler] Shutting down...");
    scheduler.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    scheduler.stop();
    process.exit(0);
  });
}

module.exports = { OrchestraScheduler };
