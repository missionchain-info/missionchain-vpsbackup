/**
 * ============================================================
 *  MissionChain — Orchestra State Machine v2.2
 *  15 states with strict transition rules per AI Team Workflow spec.
 *  Persists to JSON for PM2 restart survival.
 * ============================================================
 */

const fs = require("fs");
const path = require("path");

// ─── 15 States ───
const STATES = {
  IDLE: "IDLE",
  PLANNING: "PLANNING",
  EXECUTING: "EXECUTING",
  REVIEWING: "REVIEWING",
  DEBATING: "DEBATING",
  FIXING: "FIXING",
  VERIFYING: "VERIFYING",
  COMPILING: "COMPILING",
  REPORTING: "REPORTING",
  WAITING_HUMAN: "WAITING_HUMAN",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  CANCELLED: "CANCELLED",
  BUDGET_STOPPED: "BUDGET_STOPPED",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
};

// ─── Transition Rules ───
// Each key maps to an array of allowed next states.
const TRANSITIONS = {
  [STATES.IDLE]:              [STATES.PLANNING],
  [STATES.PLANNING]:          [STATES.EXECUTING, STATES.BLOCKED, STATES.MODEL_UNAVAILABLE, STATES.CANCELLED, STATES.BUDGET_STOPPED, STATES.FAILED],
  [STATES.EXECUTING]:         [STATES.REVIEWING, STATES.FAILED, STATES.CANCELLED, STATES.BUDGET_STOPPED],
  [STATES.REVIEWING]:         [STATES.FIXING, STATES.DEBATING, STATES.MODEL_UNAVAILABLE, STATES.CANCELLED, STATES.BUDGET_STOPPED, STATES.FAILED],
  [STATES.DEBATING]:          [STATES.FIXING, STATES.REPORTING, STATES.CANCELLED, STATES.BUDGET_STOPPED, STATES.FAILED],
  [STATES.FIXING]:            [STATES.VERIFYING, STATES.CANCELLED, STATES.BUDGET_STOPPED, STATES.FAILED],
  [STATES.VERIFYING]:         [STATES.COMPILING, STATES.DEBATING, STATES.CANCELLED, STATES.BUDGET_STOPPED, STATES.FAILED],
  [STATES.COMPILING]:         [STATES.REPORTING, STATES.CANCELLED, STATES.BUDGET_STOPPED, STATES.FAILED],
  [STATES.REPORTING]:         [STATES.WAITING_HUMAN, STATES.IDLE],
  [STATES.WAITING_HUMAN]:     [STATES.EXECUTING, STATES.IDLE, STATES.CANCELLED],
  [STATES.MODEL_UNAVAILABLE]: [STATES.WAITING_HUMAN],
  [STATES.BLOCKED]:           [STATES.WAITING_HUMAN, STATES.CANCELLED],
  [STATES.BUDGET_STOPPED]:    [STATES.WAITING_HUMAN, STATES.CANCELLED],
  [STATES.FAILED]:            [STATES.IDLE, STATES.CANCELLED],
  [STATES.CANCELLED]:         [], // Terminal state — no transitions allowed
};

// ─── State Machine Class ───
class OrchestraStateMachine {
  /**
   * @param {string} taskId — Unique task identifier
   * @param {string} [initialState] — Starting state (default: IDLE)
   */
  constructor(taskId, initialState = STATES.IDLE) {
    this.taskId = taskId;
    this.state = initialState;
    this.history = []; // Array of { from, to, timestamp, reason }
    this.createdAt = new Date().toISOString();
  }

  /**
   * Transition to a new state.
   * @param {string} newState — Target state (must be in STATES)
   * @param {string} [reason] — Why this transition happened
   * @returns {OrchestraStateMachine} — this (for chaining)
   * @throws {Error} — If transition is not allowed
   */
  transition(newState, reason = "") {
    if (!STATES[newState]) {
      throw new Error(`Unknown state: "${newState}". Valid states: [${Object.keys(STATES).join(", ")}]`);
    }

    const allowed = TRANSITIONS[this.state];
    if (!allowed || !allowed.includes(newState)) {
      throw new Error(
        `Invalid transition: ${this.state} → ${newState}. ` +
        `Allowed from ${this.state}: [${(allowed || []).join(", ")}]`
      );
    }

    const entry = {
      from: this.state,
      to: newState,
      timestamp: new Date().toISOString(),
      reason,
    };

    this.history.push(entry);
    this.state = newState;
    return this;
  }

  /**
   * Check if a transition to newState is allowed from current state.
   */
  canTransition(newState) {
    return (TRANSITIONS[this.state] || []).includes(newState);
  }

  /**
   * Is the current state terminal (CANCELLED)?
   */
  isTerminal() {
    return this.state === STATES.CANCELLED;
  }

  /**
   * Is the state machine waiting for human (Founder) decision?
   */
  isWaitingHuman() {
    return this.state === STATES.WAITING_HUMAN;
  }

  /**
   * Is the state an error/stop state?
   */
  isErrorState() {
    return [STATES.FAILED, STATES.BLOCKED, STATES.BUDGET_STOPPED, STATES.MODEL_UNAVAILABLE].includes(this.state);
  }

  /**
   * Get allowed transitions from current state.
   */
  getAllowedTransitions() {
    return TRANSITIONS[this.state] || [];
  }

  /**
   * Serialize to JSON for persistence.
   */
  toJSON() {
    return {
      task_id: this.taskId,
      current_state: this.state,
      created_at: this.createdAt,
      history: this.history,
    };
  }

  /**
   * Restore from persisted JSON data (survives PM2 restart).
   * @param {object} data — Output from toJSON()
   * @returns {OrchestraStateMachine}
   */
  static fromJSON(data) {
    const sm = new OrchestraStateMachine(data.task_id, data.current_state);
    sm.createdAt = data.created_at || data.createdAt || new Date().toISOString();
    sm.history = data.history || [];
    return sm;
  }

  /**
   * Persist state machine to a JSON file.
   * @param {string} dir — Directory to save in (e.g. data/artifacts/)
   */
  persistTo(dir) {
    const filePath = path.join(dir, `sm_${this.taskId}.json`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(this.toJSON(), null, 2), "utf8");
    return filePath;
  }

  /**
   * Load state machine from a persisted file.
   * @param {string} dir — Directory to load from
   * @param {string} taskId — Task ID to load
   * @returns {OrchestraStateMachine|null}
   */
  static loadFrom(dir, taskId) {
    const filePath = path.join(dir, `sm_${taskId}.json`);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return OrchestraStateMachine.fromJSON(data);
  }
}

module.exports = { OrchestraStateMachine, STATES, TRANSITIONS };
