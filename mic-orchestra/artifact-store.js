/**
 * ============================================================
 *  MissionChain — Artifact Store v2.2
 *  Manages persistence of task artifacts, findings, and debate
 *  logs per AI Team Workflow spec Section 7.
 *  Storage: JSON files in data/ directory.
 * ============================================================
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");
const FINDINGS_DIR = path.join(DATA_DIR, "findings");
const DEBATE_DIR = path.join(DATA_DIR, "debate-logs");

// Ensure directories exist
[ARTIFACTS_DIR, FINDINGS_DIR, DEBATE_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

/**
 * Generate a unique ID with timestamp prefix.
 * Format: prefix_YYYYMMDD_HHmmss_random6
 */
function generateId(prefix) {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, "").substring(0, 14); // YYYYMMDDHHMMSS
  const rand = crypto.randomBytes(3).toString("hex"); // 6 hex chars
  return `${prefix}_${ts}_${rand}`;
}

class ArtifactStore {

  // ─── Task CRUD ───

  /**
   * Create a new task artifact with full v2.2 schema.
   * @param {string} directive — Founder's directive text
   * @param {string} workflowType — 'coding'|'content'|'audit'|'strategy'
   * @param {string} scope — Files/modules/docs in scope
   * @param {object} constraints — Additional constraints
   * @returns {object} — Created task artifact
   */
  createTask(directive, workflowType, scope, constraints = {}) {
    const now = new Date().toISOString();
    const taskId = generateId("task");
    const artifactId = generateId("art");

    const artifact = {
      // --- Identification ---
      task_id: taskId,
      artifact_id: artifactId,
      workflow_type: workflowType,
      directive,
      scope,
      constraints,
      baseline_ref: null,
      owner: "orchestra",

      // --- Source of Truth ---
      source_of_truth_refs: [
        "docs/AI-TEAM-WORKFLOW-GUIDE.html",
        "CLAUDE.md",
      ],

      // --- Findings ---
      findings: [],

      // --- Pipeline Resolution ---
      status: "draft", // draft|in_progress|resolved_in_pipeline|reported|closed|reopened|failed|blocked|cancelled
      pipeline_resolution: null, // resolved|escalated|blocked|failed
      created_at: now,
      updated_at: now,
      resolved_at: null,

      // --- Human Decision ---
      human_decision: null, // approve|veto|reopen|defer|reject|revise
      approval_by: null,
      approval_at: null,
      reopened_by: null,
      reopened_reason: null,

      // --- Execution Mode ---
      execution_mode: "normal", // normal|exception
      missing_models: [],
      founder_override: false,
      founder_override_reason: null,
      model_versions: {
        claude: null,
        codex: null,
        gemini: null,
      },
      cost_summary: {
        total_usd: 0,
        breakdown: { claude: 0, codex: 0, gemini: 0 },
      },

      // --- State Machine ---
      current_state: "IDLE",
      state_history: [],

      // --- Debate ---
      debate_rounds: 0,
      debate_log_refs: [],
    };

    this._saveArtifact(taskId, artifact);
    return artifact;
  }

  /**
   * Get a task artifact by ID.
   * @param {string} taskId
   * @returns {object|null}
   */
  getTask(taskId) {
    const filePath = path.join(ARTIFACTS_DIR, `${taskId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  /**
   * Update task artifact fields (merge).
   * @param {string} taskId
   * @param {object} updates — Fields to merge
   * @returns {object} — Updated artifact
   */
  updateTask(taskId, updates) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    Object.assign(task, updates, { updated_at: new Date().toISOString() });
    this._saveArtifact(taskId, task);
    return task;
  }

  /**
   * List all tasks with optional filters.
   * @param {object} filters — { status, workflow_type, limit }
   * @returns {object[]}
   */
  listTasks(filters = {}) {
    const files = fs.readdirSync(ARTIFACTS_DIR)
      .filter(f => f.startsWith("task_") && f.endsWith(".json"));

    let tasks = files.map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, f), "utf8"));
      } catch { return null; }
    }).filter(Boolean);

    // Apply filters
    if (filters.status) {
      tasks = tasks.filter(t => t.status === filters.status);
    }
    if (filters.workflow_type) {
      tasks = tasks.filter(t => t.workflow_type === filters.workflow_type);
    }

    // Sort by created_at descending (newest first)
    tasks.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    if (filters.limit) {
      tasks = tasks.slice(0, filters.limit);
    }

    return tasks;
  }

  // ─── Findings ───

  /**
   * Add a finding to a task.
   * @param {string} taskId
   * @param {object} finding — { severity, category, description, evidence, recommendation }
   * @returns {object} — Created finding with finding_id
   */
  addFinding(taskId, finding) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const findingObj = {
      finding_id: generateId("find"),
      severity: finding.severity || "MEDIUM", // LOW|MEDIUM|HIGH|CRITICAL
      category: finding.category || "general",
      description: finding.description || "",
      evidence: finding.evidence || "",
      recommendation: finding.recommendation || "",
      debate_state: "pending", // pending|consensus|contested|waived
      created_at: new Date().toISOString(),
      resolved_at: null,
    };

    task.findings.push(findingObj);
    task.updated_at = new Date().toISOString();
    this._saveArtifact(taskId, task);

    // Also save individual finding file
    fs.writeFileSync(
      path.join(FINDINGS_DIR, `${findingObj.finding_id}.json`),
      JSON.stringify({ ...findingObj, task_id: taskId }, null, 2),
      "utf8"
    );

    return findingObj;
  }

  /**
   * Update a finding's debate_state or resolved_at.
   */
  updateFinding(taskId, findingId, updates) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const finding = task.findings.find(f => f.finding_id === findingId);
    if (!finding) throw new Error(`Finding not found: ${findingId}`);

    Object.assign(finding, updates);
    task.updated_at = new Date().toISOString();
    this._saveArtifact(taskId, task);
    return finding;
  }

  // ─── Debate Logs ───

  /**
   * Add a debate log for a task round.
   * @param {string} taskId
   * @param {number} round — Round number (1, 2, 3)
   * @param {object} transcript — Full debate transcript data
   * @returns {string} — Path to saved debate log
   */
  addDebateLog(taskId, round, transcript) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const filename = `debate_${taskId}_round${round}.json`;
    const filePath = path.join(DEBATE_DIR, filename);

    const log = {
      task_id: taskId,
      round,
      created_at: new Date().toISOString(),
      participants: transcript.participants || [],
      exchanges: transcript.exchanges || [],
      outcome: transcript.outcome || "pending", // consensus|no_consensus|escalated
    };

    fs.writeFileSync(filePath, JSON.stringify(log, null, 2), "utf8");

    // Update task
    task.debate_rounds = Math.max(task.debate_rounds, round);
    if (!task.debate_log_refs.includes(filename)) {
      task.debate_log_refs.push(filename);
    }
    task.updated_at = new Date().toISOString();
    this._saveArtifact(taskId, task);

    return filePath;
  }

  /**
   * Get debate logs for a task.
   * @param {string} taskId
   * @returns {object[]}
   */
  getDebateLogs(taskId) {
    const task = this.getTask(taskId);
    if (!task) return [];

    return task.debate_log_refs.map(ref => {
      const filePath = path.join(DEBATE_DIR, ref);
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }).filter(Boolean);
  }

  // ─── Human Decision ───

  /**
   * Set human (Founder) decision on a task.
   * @param {string} taskId
   * @param {string} decision — 'approve'|'veto'|'reopen'|'defer'|'reject'|'revise'
   * @param {string} approvedBy — Founder name/ID
   * @returns {object} — Updated task
   */
  setHumanDecision(taskId, decision, approvedBy) {
    const now = new Date().toISOString();
    const updates = {
      human_decision: decision,
      updated_at: now,
    };

    if (decision === "approve") {
      updates.status = "closed";
      updates.approval_by = approvedBy;
      updates.approval_at = now;
    } else if (decision === "veto" || decision === "reopen") {
      updates.status = "reopened";
      updates.reopened_by = approvedBy;
      updates.reopened_reason = `${decision} by ${approvedBy} at ${now}`;
    } else if (decision === "reject") {
      updates.status = "cancelled";
    } else if (decision === "defer") {
      updates.status = "reported"; // stays in reported state
    }

    return this.updateTask(taskId, updates);
  }

  /**
   * Reopen a task with reason.
   */
  reopenTask(taskId, reason, reopenedBy) {
    return this.updateTask(taskId, {
      status: "reopened",
      human_decision: "reopen",
      reopened_by: reopenedBy,
      reopened_reason: reason,
      resolved_at: null,
    });
  }

  // ─── Private Helpers ───

  _saveArtifact(taskId, data) {
    const filePath = path.join(ARTIFACTS_DIR, `${taskId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  }
}

module.exports = ArtifactStore;
