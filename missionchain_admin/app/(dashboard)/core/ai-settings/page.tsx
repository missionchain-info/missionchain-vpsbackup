'use client';

import { useState, useEffect, useCallback } from 'react';
import SectionHead from '@/components/ui/SectionHead';
import StatCard from '@/components/ui/StatCard';
import DataTable from '@/components/ui/DataTable';
import Badge from '@/components/ui/Badge';
import { checkModels, getReadiness, getPipelineStatus, getPipelineTasks, submitDecision, cancelTask, startPipeline, updateBudget, reloadConfig, updateProvider, updateTelegram } from '@/lib/api';

/* ───────────────────────────────────────────────────────
   AI SETTINGS v2.2 — planning/control-plane prototype.
   3-tier closure, model #2 mandatory, 15-state machine,
   full artifact schema, MissionChain content sync.
   ─────────────────────────────────────────────────────── */

const SUB_TABS = [
  'Workflow Overview',
  'AI Team & Roles',
  'API & Credentials',
  'Budget & Scheduler',
  'Telegram & Notifications',
];

// ─── Workflow Pipeline Data ───
interface WorkflowStep {
  order: number;
  agent: string;
  role: string;
  action: string;
  color: string;
}

interface Workflow {
  id: string;
  name: string;
  icon: string;
  description: string;
  status: 'active' | 'ready' | 'planned';
  steps: WorkflowStep[];
}

const WORKFLOWS: Workflow[] = [
  {
    id: 'coding',
    name: 'CODING',
    icon: '💻',
    description: 'Build workflow: model check → auto-dispatch → review → debate → fix → DONE/ESCALATION report',
    status: 'planned',
    steps: [
      { order: 1, agent: 'Founder', role: 'Directive', action: 'Assign task + set boundary', color: 'var(--gold)' },
      { order: 2, agent: 'Orchestra', role: 'Plan & Model Check', action: 'Classify workflow → verify Codex + Gemini available', color: 'var(--purple)' },
      { order: 3, agent: 'Orchestra', role: 'Auto-Dispatch', action: 'Dispatch Claude Code → build patch', color: 'var(--purple)' },
      { order: 4, agent: 'Claude Code', role: 'Build', action: 'Write code per approved design', color: 'var(--purple)' },
      { order: 5, agent: 'Orchestra', role: 'Auto-Trigger', action: 'Auto-trigger Codex + Gemini review (both required)', color: 'var(--purple)' },
      { order: 6, agent: 'Codex + Gemini', role: 'Review', action: 'Security + Architecture review in parallel', color: 'var(--green)' },
      { order: 7, agent: 'Orchestra', role: 'Debate Mgr', action: 'Manage debate (max 3 rounds, no voting) → consensus or escalate', color: 'var(--orange)' },
      { order: 8, agent: 'Claude Code', role: 'Fix & Verify', action: 'Fix findings → auto re-review → verify', color: 'var(--purple)' },
      { order: 9, agent: 'Orchestra', role: 'Report', action: 'DONE REPORT (resolved_in_pipeline) or ESCALATION → Founder', color: 'var(--gold)' },
      { order: 10, agent: 'Founder', role: 'Human Gate', action: 'Approve / veto / reopen / defer → only then formally closed', color: 'var(--gold)' },
    ],
  },
  {
    id: 'content',
    name: 'CONTENT & DOCS',
    icon: '📝',
    description: 'Source-of-truth workflow: Fullstack→NEU sync, archive exclusion, translation pipeline, tokenomics grep',
    status: 'planned',
    steps: [
      { order: 1, agent: 'Founder', role: 'Directive', action: 'Content request, audience, doc class', color: 'var(--gold)' },
      { order: 2, agent: 'Orchestra', role: 'Plan & Model Check', action: 'Classify CONTENT → model check → set source-of-truth gates', color: 'var(--purple)' },
      { order: 3, agent: 'Claude Writer', role: 'Draft', action: 'Write content per MissionChain brand voice', color: 'var(--purple)' },
      { order: 4, agent: 'Orchestra', role: 'Auto-Review', action: 'Trigger Codex (tokenomics/fact-check) + Gemini (i18n/readability)', color: 'var(--purple)' },
      { order: 5, agent: 'Orchestra', role: 'SoT Gate', action: 'Active vs archive, internal vs public, tokenomics grep verify', color: 'var(--orange)' },
      { order: 6, agent: 'Orchestra', role: 'Sync Check', action: 'Fullstack→NEU mapping, translation impact, exclude archive docs', color: 'var(--orange)' },
      { order: 7, agent: 'Orchestra', role: 'Report', action: 'DONE: publish package → Founder approve or ESCALATION', color: 'var(--gold)' },
      { order: 8, agent: 'Founder', role: 'Human Gate', action: 'Approve publication / sync / veto / reopen', color: 'var(--gold)' },
    ],
  },
  {
    id: 'audit',
    name: 'CODE AUDIT',
    icon: '🔍',
    description: 'Tribunal workflow: both Codex + Gemini required. Missing model → stop → notify Founder',
    status: 'planned',
    steps: [
      { order: 1, agent: 'Scheduler / Founder', role: 'Trigger', action: 'Auto-schedule or manual trigger', color: 'var(--gold)' },
      { order: 2, agent: 'Orchestra', role: 'Model Check', action: 'Codex OK? Gemini OK? If missing → STOP → notify Founder', color: 'var(--red)' },
      { order: 3, agent: 'Orchestra', role: 'Auto-Dispatch', action: 'Dispatch Codex + Gemini audit in parallel', color: 'var(--purple)' },
      { order: 4, agent: 'Codex + Gemini', role: 'Audit', action: 'Independent security + architecture audit (both required)', color: 'var(--green)' },
      { order: 5, agent: 'Orchestra', role: 'Deduplicate', action: 'Deduplicate findings → assign Claude fix', color: 'var(--purple)' },
      { order: 6, agent: 'Orchestra', role: 'Debate Mgr', action: 'Debate for disputed findings (max 3 rounds, no voting)', color: 'var(--orange)' },
      { order: 7, agent: 'Orchestra', role: 'Report', action: 'DONE artifact → Founder or ESCALATION unresolved', color: 'var(--gold)' },
      { order: 8, agent: 'Founder', role: 'Human Gate', action: 'Approve / veto / reopen / assign fix', color: 'var(--gold)' },
    ],
  },
  {
    id: 'strategy',
    name: 'STRATEGY & PLANNING',
    icon: '🎯',
    description: 'Analysis workflow: confidence labels, counter-points, evidence-backed vs inference',
    status: 'planned',
    steps: [
      { order: 1, agent: 'Founder', role: 'Directive', action: 'Strategic question + decision horizon', color: 'var(--gold)' },
      { order: 2, agent: 'Orchestra', role: 'Scope & Model Check', action: 'Scope question → model check → dispatch agents', color: 'var(--purple)' },
      { order: 3, agent: 'Claude', role: 'Lead Synthesis', action: 'Deep analysis with MC_KNOWLEDGE base', color: 'var(--purple)' },
      { order: 4, agent: 'Codex + Gemini', role: 'Challenge', action: 'Challenge assumptions + verify data', color: 'var(--green)' },
      { order: 5, agent: 'Orchestra', role: 'Confidence Label', action: 'Mark [evidence-backed] / [inference] / [open question]', color: 'var(--orange)' },
      { order: 6, agent: 'Orchestra', role: 'Report', action: 'DONE: strategy memo → Founder or ESCALATION open questions', color: 'var(--gold)' },
      { order: 7, agent: 'Founder', role: 'Human Gate', action: 'Use report to decide / request deeper analysis', color: 'var(--gold)' },
    ],
  },
];

// ─── AI Team Members ───
interface AITeamMember {
  name: string;
  provider: string;
  role: string;
  icon: string;
  primaryModel: string;
  fallbackModel: string;
  color: string;
  required: boolean;
  capabilities: string[];
}

const AI_TEAM: AITeamMember[] = [
  {
    name: 'Orchestra (Claude)',
    provider: 'Anthropic',
    role: 'Proactive Orchestrator & Pipeline Driver',
    icon: '🎭',
    primaryModel: 'claude-sonnet-4-20250514',
    fallbackModel: 'claude-haiku-4-5-20251001',
    color: 'var(--purple)',
    required: true,
    capabilities: [
      'Proactively drives pipeline end-to-end',
      'Model check before dispatch (mandatory)',
      'Auto-dispatch tasks to agents',
      'Manage debate cycles (max 3 rounds, NO voting)',
      'Compile DEBATE + FIX → DONE/ESCALATION report',
      'Detect missing model → STOP → notify Founder',
      'State machine: 15 states incl. FAILED/BLOCKED/MODEL_UNAVAILABLE',
      'CANNOT: merge, deploy, degrade to 2-model, close finding',
    ],
  },
  {
    name: 'Claude Code',
    provider: 'Anthropic',
    role: 'Coder & Builder',
    icon: '💻',
    primaryModel: 'claude-sonnet-4-20250514',
    fallbackModel: 'claude-haiku-4-5-20251001',
    color: 'var(--purple)',
    required: true,
    capabilities: ['Solidity smart contract coding', 'Next.js / React frontend', 'Fastify API backend', 'Database schema & migrations', 'Participate in debate (defend fixes)', 'Test writing & debugging'],
  },
  {
    name: 'Codex (GPT)',
    provider: 'OpenAI',
    role: 'Auditor #1 — Required for Tribunal',
    icon: '🔒',
    primaryModel: 'o1',
    fallbackModel: 'gpt-4o',
    color: 'var(--green)',
    required: true,
    capabilities: ['Security vulnerability detection', 'Reentrancy & overflow analysis', 'Smart contract bug hunting', 'Code quality assessment', 'Debate: [AGREE/DISAGREE/CONCEDE]'],
  },
  {
    name: 'Gemini',
    provider: 'Google',
    role: 'Auditor #2 — Required for Tribunal',
    icon: '🌐',
    primaryModel: 'gemini-2.5-flash',
    fallbackModel: 'gemini-2.0-flash',
    color: 'var(--blue)',
    required: true,
    capabilities: ['Architecture & logic review', 'Gas optimization analysis', 'Economic attack detection', 'Cross-cultural content review', 'MANDATORY for formal tribunal — missing = pipeline stops'],
  },
];

// ─── Scheduler Data ───
const SCHEDULE_JOBS = [
  { name: 'Smart Contract Audit', cron: '0 6 * * *', schedule: 'Daily 6:00 AM UTC', phase: 'contracts', status: 'active' },
  { name: 'API Security Check', cron: '0 */6 * * *', schedule: 'Every 6 hours', phase: 'api', status: 'active' },
  { name: 'Full Production Audit', cron: '0 2 * * 0', schedule: 'Sunday 2:00 AM UTC', phase: 'full', status: 'active' },
  { name: 'Frontend Audit', cron: '0 3 * * 3', schedule: 'Wednesday 3:00 AM UTC', phase: 'web', status: 'active' },
];

const scheduleColumns = [
  { key: 'name', label: 'Job Name' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'cron', label: 'Cron Expression', className: 'td-mono' },
  { key: 'phase', label: 'Phase' },
  { key: 'status', label: 'Status', render: (v: string) => <Badge variant={v === 'active' ? 'active' : 'draft'}>{v}</Badge> },
];

// ─── Cost Tiers ───
const COST_TIERS = [
  { tier: 'Tier 1 — FREE', method: 'Regex keyword matching', cost: '$0.000', coverage: '~60-70% commands', color: 'var(--green)' },
  { tier: 'Tier 2 — Cheap', method: 'Claude Haiku intent parsing', cost: '~$0.001', coverage: 'Ambiguous intents', color: 'var(--blue)' },
  { tier: 'Tier 3 — Cheap', method: 'Claude Haiku response format', cost: '~$0.001', coverage: 'Complex formatting', color: 'var(--blue)' },
  { tier: 'Tier 4 — Mid', method: 'Claude Sonnet deep analysis', cost: '~$0.005', coverage: 'Strategic questions', color: 'var(--orange)' },
];

// ─── Render Helpers ───
function FlowDiagram({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', padding: '16px', background: 'var(--bg)', borderRadius: '8px', border: '1px solid var(--border)' }}>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <div style={{
            background: 'var(--surface)',
            border: `1px solid ${step.color}`,
            borderRadius: '8px',
            padding: '10px 14px',
            minWidth: '140px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '10px', fontWeight: 700, color: step.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Step {step.order} — {step.role}
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, marginTop: '4px' }}>{step.agent}</div>
            <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>{step.action}</div>
          </div>
          {i < steps.length - 1 && <span style={{ color: 'var(--gold)', fontSize: '18px', fontWeight: 700 }}>→</span>}
        </div>
      ))}
    </div>
  );
}

function TeamCard({ member }: { member: AITeamMember }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: `1px solid var(--border)`,
      borderTop: `3px solid ${member.color}`,
      borderRadius: '8px',
      padding: '20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <span style={{ fontSize: '28px' }}>{member.icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: '15px' }}>{member.name}</div>
          <div style={{ fontSize: '12px', color: member.color, fontWeight: 600 }}>{member.role}</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <Badge variant={member.required ? 'gold' : 'teal'}>{member.required ? 'Required' : 'Optional'}</Badge>
        </div>
      </div>
      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
        Provider: <strong style={{ color: 'var(--text)' }}>{member.provider}</strong>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '12px' }}>
        <div className="form-group">
          <label className="form-label" style={{ fontSize: '10px' }}>Primary Model</label>
          <input className="form-input" value={member.primaryModel} readOnly style={{ opacity: 0.7, fontSize: '12px', padding: '6px 8px' }} />
        </div>
        <div className="form-group">
          <label className="form-label" style={{ fontSize: '10px' }}>Fallback Model</label>
          <input className="form-input" value={member.fallbackModel} readOnly style={{ opacity: 0.7, fontSize: '12px', padding: '6px 8px' }} />
        </div>
      </div>
      <div style={{ fontSize: '12px' }}>
        <div style={{ fontWeight: 600, marginBottom: '4px', color: 'var(--gold)' }}>Capabilities:</div>
        {member.capabilities.map((cap, i) => (
          <div key={i} style={{ padding: '2px 0', color: 'var(--muted)' }}>• {cap}</div>
        ))}
      </div>
    </div>
  );
}

// ─── Types for API responses ───
interface ModelStatus {
  status: 'ok' | 'unavailable' | 'no_key';
  model: string;
  latency_ms: number;
  error?: string;
}

interface ModelCheckResult {
  claude: ModelStatus;
  codex: ModelStatus;
  gemini: ModelStatus;
  tribunal_ready: boolean;
  reason: string | null;
  checked_at: string;
}

interface ReadinessGate {
  gate: string;
  name: string;
  status: boolean;
  detail: string;
}

interface ReadinessResult {
  ready: boolean;
  passed: number;
  total: number;
  gates: ReadinessGate[];
}

interface PipelineTask {
  task_id: string;
  workflow_type: string;
  directive: string;
  status: string;
  current_state: string;
  created_at: string;
  execution_mode: string;
  findings: any[];
  human_decision: string | null;
}

// ─── Main Page Component ───
export default function AISettingsPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [dailyBudget, setDailyBudget] = useState(20);
  const [monthlyBudget, setMonthlyBudget] = useState(300);
  const [expandedWorkflow, setExpandedWorkflow] = useState<string | null>('coding');

  // ─── Live API State ───
  const [modelCheck, setModelCheck] = useState<ModelCheckResult | null>(null);
  const [readiness, setReadiness] = useState<ReadinessResult | null>(null);
  const [pipelineTasks, setPipelineTasks] = useState<PipelineTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [savingBudget, setSavingBudget] = useState(false);
  const [budgetMsg, setBudgetMsg] = useState<string | null>(null);

  // ─── New Directive Form ───
  const [directiveText, setDirectiveText] = useState('');
  const [directiveWorkflow, setDirectiveWorkflow] = useState('coding');
  const [directiveScope, setDirectiveScope] = useState('');
  const [startingPipeline, setStartingPipeline] = useState(false);
  const [pipelineMsg, setPipelineMsg] = useState<string | null>(null);

  // ─── API Keys State (editable) ───
  const [anthropicKey, setAnthropicKey] = useState('');
  const [anthropicModel, setAnthropicModel] = useState('claude-sonnet-4-20250514');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState('o1');
  const [googleKey, setGoogleKey] = useState('');
  const [googleModel, setGoogleModel] = useState('gemini-2.5-flash');
  const [savingApi, setSavingApi] = useState<string | null>(null); // which provider is saving
  const [apiMsg, setApiMsg] = useState<string | null>(null);

  // ─── Telegram State (editable) ───
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [telegramMsg, setTelegramMsg] = useState<string | null>(null);

  // Token from sessionStorage (set during login)
  const getToken = () => typeof window !== 'undefined' ? sessionStorage.getItem('token') || '' : '';

  // ─── Fetch All Data ───
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [models, ready, tasks] = await Promise.allSettled([
        checkModels(),
        getReadiness(getToken()),
        getPipelineTasks(getToken(), { limit: 20 }),
      ]);

      if (models.status === 'fulfilled') setModelCheck(models.value);
      if (ready.status === 'fulfilled') setReadiness(ready.value);
      if (tasks.status === 'fulfilled') setPipelineTasks(tasks.value.tasks || []);

      setLastRefresh(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Auto-fetch on mount ───
  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 60_000); // refresh every 60s
    return () => clearInterval(interval);
  }, [fetchAll]);

  // ─── Model status helper ───
  const getModelBadge = (status?: ModelStatus) => {
    if (!status) return <Badge variant="draft">Unknown</Badge>;
    if (status.status === 'ok') return <Badge variant="active">Connected ({status.latency_ms}ms)</Badge>;
    if (status.status === 'no_key') return <Badge variant="pending">No API Key</Badge>;
    return <Badge variant="draft">Unavailable</Badge>;
  };

  // ─── Save Budget Handler ───
  const handleSaveBudget = async () => {
    setSavingBudget(true);
    setBudgetMsg(null);
    try {
      await updateBudget({ daily: dailyBudget, monthly: monthlyBudget }, getToken());
      setBudgetMsg('Budget saved successfully!');
      setTimeout(() => setBudgetMsg(null), 3000);
    } catch (err: any) {
      setBudgetMsg(`Error: ${err.message}`);
    } finally {
      setSavingBudget(false);
    }
  };

  // ─── Reload Config Handler ───
  const handleReload = async () => {
    try {
      await reloadConfig(getToken());
      fetchAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── Save Provider API Key ───
  const handleSaveProvider = async (provider: string) => {
    setSavingApi(provider);
    setApiMsg(null);
    try {
      const data: any = {};
      if (provider === 'anthropic') {
        if (anthropicKey) data.apiKey = anthropicKey;
        data.primaryModel = anthropicModel;
      } else if (provider === 'openai') {
        if (openaiKey) data.apiKey = openaiKey;
        data.primaryModel = openaiModel;
      } else if (provider === 'google') {
        if (googleKey) data.apiKey = googleKey;
        data.primaryModel = googleModel;
      }
      await updateProvider(provider, data, getToken());
      setApiMsg(`${provider} saved successfully!`);
      setTimeout(() => setApiMsg(null), 3000);
      fetchAll(); // refresh model status
    } catch (err: any) {
      setApiMsg(`Error: ${err.message}`);
    } finally {
      setSavingApi(null);
    }
  };

  // ─── Save Telegram Config ───
  const handleSaveTelegram = async () => {
    setSavingTelegram(true);
    setTelegramMsg(null);
    try {
      const data: any = {};
      if (telegramToken) data.botToken = telegramToken;
      if (telegramChatId) data.chatId = telegramChatId;
      await updateTelegram(data, getToken());
      setTelegramMsg('Telegram config saved successfully!');
      setTimeout(() => setTelegramMsg(null), 3000);
    } catch (err: any) {
      setTelegramMsg(`Error: ${err.message}`);
    } finally {
      setSavingTelegram(false);
    }
  };

  // ─── Start Pipeline Handler ───
  const handleStartPipeline = async () => {
    if (!directiveText.trim()) { setPipelineMsg('Error: Directive is required'); return; }
    setStartingPipeline(true);
    setPipelineMsg(null);
    try {
      const result = await startPipeline({
        directive: directiveText.trim(),
        workflow_type: directiveWorkflow,
        scope: directiveScope.trim() || 'general',
      }, getToken());
      setPipelineMsg(`Pipeline started! Task: ${result.task_id || 'created'} — State: ${result.state || 'PLANNING'}`);
      setDirectiveText('');
      setDirectiveScope('');
      fetchAll(); // refresh task list
    } catch (err: any) {
      setPipelineMsg(`Error: ${err.message}`);
    } finally {
      setStartingPipeline(false);
    }
  };

  return (
    <>
      <SectionHead title="AI Settings — Workflow v2.2" action={
        <Badge variant="gold">v2.2 Final Lock</Badge>
      } />

      <div className="banner banner-warn" style={{ marginBottom: '20px' }}>
        <strong>v2.2:</strong> 3-tier closure (resolved → reported → closed by human). Model #2 mandatory for tribunal — missing model stops pipeline, notifies Founder. Orchestra proactively drives pipeline but CANNOT merge/deploy/close finding.
      </div>

      {/* ─── Sub Tabs ─── */}
      <div className="sub-tabs" style={{ marginBottom: '20px' }}>
        {SUB_TABS.map((tab, i) => (
          <button key={tab} className={`sub-tab${i === activeTab ? ' active' : ''}`} onClick={() => setActiveTab(i)}>{tab}</button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════
          TAB 0: WORKFLOW OVERVIEW
         ════════════════════════════════════════════════════════ */}
      {activeTab === 0 && (
        <>
          {/* Refresh Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <button className="btn btn-outline" onClick={fetchAll} disabled={loading}>
              {loading ? 'Refreshing...' : 'Refresh Status'}
            </button>
            {lastRefresh && <span style={{ fontSize: '11px', color: 'var(--muted)' }}>Last: {lastRefresh}</span>}
            {error && <span style={{ fontSize: '12px', color: 'var(--red)' }}>{error}</span>}
          </div>

          {/* Live Model Status */}
          {modelCheck && (
            <div style={{ background: 'var(--surface)', border: `1px solid ${modelCheck.tribunal_ready ? 'var(--green)' : 'var(--red)'}`, borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                <span style={{ fontSize: '16px' }}>{modelCheck.tribunal_ready ? '✅' : '⚠️'}</span>
                <span style={{ fontWeight: 700, color: modelCheck.tribunal_ready ? 'var(--green)' : 'var(--red)' }}>
                  Tribunal: {modelCheck.tribunal_ready ? 'READY — All 3 Models Connected' : 'NOT READY — Missing Models'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                <div style={{ fontSize: '12px' }}>Claude ({modelCheck.claude.model}): {getModelBadge(modelCheck.claude)}</div>
                <div style={{ fontSize: '12px' }}>Codex ({modelCheck.codex.model}): {getModelBadge(modelCheck.codex)}</div>
                <div style={{ fontSize: '12px' }}>Gemini ({modelCheck.gemini.model}): {getModelBadge(modelCheck.gemini)}</div>
              </div>
              {modelCheck.reason && <div style={{ fontSize: '11px', color: 'var(--red)', marginTop: '8px' }}>{modelCheck.reason}</div>}
            </div>
          )}

          {/* Readiness Gates */}
          {readiness && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
              <div style={{ fontWeight: 700, marginBottom: '10px', color: readiness.ready ? 'var(--green)' : 'var(--orange)' }}>
                Readiness Gates: {readiness.passed}/{readiness.total} passed {readiness.ready ? '✅' : '⚠️'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '6px' }}>
                {readiness.gates.map(g => (
                  <div key={g.gate} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{g.status ? '✅' : '❌'}</span>
                    <span style={{ fontWeight: 600 }}>{g.gate}:</span>
                    <span style={{ color: 'var(--muted)' }}>{g.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── New Directive Form ─── */}
          <div style={{ background: 'var(--surface)', border: '2px solid var(--gold)', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
            <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: '14px', fontSize: '15px' }}>
              New Directive — Assign Task to Orchestra
            </div>
            {pipelineMsg && (
              <div style={{ padding: '10px 14px', marginBottom: '12px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, background: pipelineMsg.startsWith('Error') ? 'rgba(255,0,0,0.1)' : 'rgba(0,200,0,0.1)', color: pipelineMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>
                {pipelineMsg}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div className="form-group">
                <label className="form-label">Workflow Type</label>
                <select className="form-input" value={directiveWorkflow} onChange={e => setDirectiveWorkflow(e.target.value)}>
                  <option value="coding">CODING — Build / implement features</option>
                  <option value="content">CONTENT — Docs / source-of-truth sync</option>
                  <option value="audit">CODE AUDIT — Security tribunal (all 3 models required)</option>
                  <option value="strategy">STRATEGY — Analysis / planning</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Scope (files, modules, or area)</label>
                <input className="form-input" placeholder="e.g. smart contracts, frontend, whitepaper..." value={directiveScope} onChange={e => setDirectiveScope(e.target.value)} />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label className="form-label">Directive — What should the AI team do?</label>
              <textarea className="form-input" rows={3} placeholder="Describe the task clearly: goal, boundaries, expected output..." value={directiveText} onChange={e => setDirectiveText(e.target.value)} style={{ resize: 'vertical', minHeight: '80px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button className="btn btn-primary" onClick={handleStartPipeline} disabled={startingPipeline || !directiveText.trim()} style={{ padding: '10px 28px', fontSize: '14px', fontWeight: 700 }}>
                {startingPipeline ? 'Starting...' : 'Start Pipeline'}
              </button>
              <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                Orchestra will check model availability → plan → dispatch → review → report back.
              </span>
            </div>
          </div>

          {/* Stats */}
          <div className="stat-grid">
            <StatCard label="Workflows" value="4" sub="Coding • Content • Audit • Strategy" color="gold" />
            <StatCard label="AI Agents" value="4" sub="Orchestra • Claude Code • Codex • Gemini" color="purple" />
            <StatCard label="Pipeline Tasks" value={String(pipelineTasks.length)} sub={pipelineTasks.filter(t => t.status === 'in_progress').length + ' in progress'} color="cyan" />
            <StatCard label="Readiness" value={readiness ? `${readiness.passed}/${readiness.total}` : '...'} sub={readiness?.ready ? 'All gates passed' : 'Some gates failing'} color={readiness?.ready ? 'green' : 'gold'} />
          </div>

          {/* Master Flow Diagram */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--gold)', borderRadius: '10px', padding: '20px', margin: '20px 0' }}>
            <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: '12px', fontSize: '14px' }}>
              MASTER WORKFLOW v2.2 — Orchestra Proactive Pipeline + Model Check
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', justifyContent: 'center' }}>
              {[
                { label: 'Founder Directive', sub: 'Goal + boundary', color: 'var(--gold)' },
                { label: 'Orchestra Plans', sub: 'Classify + break tasks', color: 'var(--purple)' },
                { label: 'Model Check', sub: 'All models OK?', color: 'var(--red)' },
                { label: 'Auto-Dispatch', sub: 'Orchestra → agents', color: 'var(--purple)' },
                { label: 'Execution', sub: 'Build / draft / analyze', color: 'var(--orange)' },
                { label: 'Auto-Review', sub: 'Codex + Gemini (both req)', color: 'var(--green)' },
                { label: 'Debate + Fix', sub: 'Max 3 rounds', color: 'var(--orange)' },
                { label: 'Orchestra Report', sub: 'DONE / ESCALATION', color: 'var(--purple)' },
                { label: 'Human Gate', sub: 'Approve / veto / reopen', color: 'var(--gold)' },
              ].map((s, i, arr) => (
                <div key={i} style={{ display: 'contents' }}>
                  <div style={{
                    background: 'var(--bg)',
                    border: `2px solid ${s.color}`,
                    borderRadius: '10px',
                    padding: '10px 16px',
                    textAlign: 'center',
                    minWidth: '110px',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: s.color }}>{s.label}</div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{s.sub}</div>
                  </div>
                  {i < arr.length - 1 && <span style={{ color: 'var(--gold)', fontWeight: 700 }}>→</span>}
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '12px', color: 'var(--muted)' }}>
              v2.2: Model Check mandatory. Missing model #2 → stop → notify Founder. DONE REPORT ≠ closed. Closed only when Human approves.
            </div>
          </div>

          {/* 3-Tier Closure */}
          <SectionHead title="3-Tier Closure Model" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
            <div style={{ background: 'var(--surface)', borderTop: '3px solid var(--green)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
              <div style={{ fontWeight: 700, color: 'var(--green)', marginBottom: '6px' }}>1. Resolved by Pipeline</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>AI + Coder completed build, review, debate, fix, verify. Not yet closed — can be reopened.</div>
            </div>
            <div style={{ background: 'var(--surface)', borderTop: '3px solid var(--blue)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
              <div style={{ fontWeight: 700, color: 'var(--blue)', marginBottom: '6px' }}>2. Reported to Founder</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Orchestra sends DONE/ESCALATION report. Founder receives for review. Still not closed.</div>
            </div>
            <div style={{ background: 'var(--surface)', borderTop: '3px solid var(--gold)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px' }}>
              <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: '6px' }}>3. Closed by Human</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Founder accepts the result. This is the formal closure. Only after this can code be merged/deployed.</div>
            </div>
          </div>

          {/* Recent Pipeline Tasks */}
          {pipelineTasks.length > 0 && (
            <>
              <SectionHead title="Recent Pipeline Tasks" />
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden', marginBottom: '20px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700 }}>Task ID</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700 }}>Workflow</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700 }}>Directive</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700 }}>State</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700 }}>Status</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipelineTasks.slice(0, 10).map(task => (
                      <tr key={task.task_id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 14px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{task.task_id.substring(0, 20)}...</td>
                        <td style={{ padding: '8px 14px' }}><Badge variant="gold">{task.workflow_type}</Badge></td>
                        <td style={{ padding: '8px 14px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.directive}</td>
                        <td style={{ padding: '8px 14px' }}>
                          <Badge variant={task.current_state === 'WAITING_HUMAN' ? 'gold' : task.current_state === 'FAILED' ? 'draft' : 'active'}>
                            {task.current_state}
                          </Badge>
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          <Badge variant={task.status === 'closed' ? 'active' : task.status === 'in_progress' ? 'teal' : task.status === 'reported' ? 'gold' : 'draft'}>
                            {task.status}
                          </Badge>
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          {task.status === 'reported' && (
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button className="btn btn-primary" style={{ fontSize: '10px', padding: '2px 8px' }}
                                onClick={async () => { await submitDecision(task.task_id, 'approve', getToken()); fetchAll(); }}>
                                Approve
                              </button>
                              <button className="btn btn-outline" style={{ fontSize: '10px', padding: '2px 8px' }}
                                onClick={async () => { await submitDecision(task.task_id, 'veto', getToken()); fetchAll(); }}>
                                Veto
                              </button>
                            </div>
                          )}
                          {(task.status === 'in_progress' || task.status === 'draft') && (
                            <button className="btn btn-outline" style={{ fontSize: '10px', padding: '2px 8px' }}
                              onClick={async () => { await cancelTask(task.task_id, getToken()); fetchAll(); }}>
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* 4 Workflow Cards */}
          <SectionHead title="4 Task Workflows" />
          {WORKFLOWS.map(wf => (
            <div key={wf.id} style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              marginBottom: '12px',
              overflow: 'hidden',
            }}>
              <div
                onClick={() => setExpandedWorkflow(expandedWorkflow === wf.id ? null : wf.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px',
                  cursor: 'pointer', borderBottom: expandedWorkflow === wf.id ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: '24px' }}>{wf.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>
                    {wf.name}
                    <Badge variant={wf.status === 'active' ? 'active' : wf.status === 'ready' ? 'gold' : 'draft'} >{wf.status.toUpperCase()}</Badge>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{wf.description}</div>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  {wf.steps.length} steps
                </div>
                <span style={{ color: 'var(--gold)', fontSize: '16px' }}>
                  {expandedWorkflow === wf.id ? '▼' : '▶'}
                </span>
              </div>
              {expandedWorkflow === wf.id && (
                <div style={{ padding: '16px 20px' }}>
                  <FlowDiagram steps={wf.steps} />
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB 1: AI TEAM & ROLES
         ════════════════════════════════════════════════════════ */}
      {activeTab === 1 && (
        <>
          <div className="stat-grid">
            <StatCard label="Orchestra (Claude)" value="Pipeline Driver" sub="Auto-dispatch, manage debate, report results" color="purple" />
            <StatCard label="Claude Code" value="Builder" sub="Write code/docs in bounded scope" color="purple" />
            <StatCard label="Codex (GPT)" value="Auditor #1" sub="Required for tribunal" color="green" />
            <StatCard label="Gemini" value="Auditor #2" sub="Required for tribunal — missing = stop" color="cyan" />
          </div>

          <SectionHead title="AI Team Members" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {AI_TEAM.map(member => <TeamCard key={member.name} member={member} />)}
          </div>

          {/* Debate Protocol */}
          <SectionHead title="Debate Protocol" />
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '20px' }}>
            <div style={{ fontSize: '13px', lineHeight: '1.8' }}>
              <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: '8px' }}>Debate Protocol (per finding):</div>
              <div>1. <strong>Codex</strong> + <strong>Gemini</strong> review independently → identify findings</div>
              <div>2. <strong>Claude Code</strong> analyzes findings → propose fix + defend reasoning</div>
              <div>3. <strong>Codex rebuttal</strong>: [AGREE] / [DISAGREE] / [PARTIALLY AGREE] / [CONCEDE]</div>
              <div>4. <strong>Gemini rebuttal</strong>: independently evaluates fix proposal</div>
              <div>5. <strong>Claude Code</strong> responds: [ADJUST] / [DEFEND] / [CONCEDE]</div>
              <div>6. Repeat <strong>max 3 rounds</strong> or until Coder + Reviewers all accept</div>
              <div>7. If consensus → Orchestra marks <code>resolved_in_pipeline</code> → <strong>DONE REPORT</strong></div>
              <div>8. If no consensus → Orchestra <strong>does NOT decide on its own</strong> → <strong>ESCALATION REPORT</strong></div>
            </div>
            <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg)', borderRadius: '6px', border: '1px solid var(--orange)' }}>
              <div style={{ fontSize: '12px', color: 'var(--orange)', fontWeight: 700 }}>
                Orchestra does NOT vote in debate, only facilitates. DONE REPORT ≠ closed. Founder retains veto/reopen rights.
              </div>
            </div>
          </div>

          {/* Reporting Modes */}
          <SectionHead title="Orchestra Reporting Modes" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid var(--green)', borderRadius: '8px', padding: '20px' }}>
              <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--green)', marginBottom: '12px' }}>DONE REPORT</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
                Pipeline resolved: debate consensus, fix verified
              </div>
              <div style={{ fontSize: '13px', lineHeight: '1.8' }}>
                <div>• Task summary + results</div>
                <div>• Debate summary + Fix summary</div>
                <div>• execution_mode: normal / exception</div>
                <div>• Clearly states: pipeline-resolved, not yet human-approved</div>
                <div>• <strong>Founder retains veto / reopen rights</strong></div>
              </div>
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid var(--orange)', borderRadius: '8px', padding: '20px' }}>
              <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--orange)', marginBottom: '12px' }}>ESCALATION REPORT</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
                No consensus, CRITICAL contested, missing model, policy exception, blocked
              </div>
              <div style={{ fontSize: '13px', lineHeight: '1.8' }}>
                <div>• Contested points + pro/con analysis</div>
                <div>• Options for Founder to choose</div>
                <div>• missing_models if any</div>
                <div>• Clearly states: pipeline unresolved, requires Founder decision</div>
              </div>
            </div>
          </div>

          {/* State Machine */}
          <SectionHead title="Orchestra State Machine (15 States)" />
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '20px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
              {[
                { label: 'IDLE', color: 'var(--muted)' },
                { label: 'PLANNING', color: 'var(--purple)' },
                { label: 'EXECUTING', color: 'var(--blue)' },
                { label: 'REVIEWING', color: 'var(--green)' },
                { label: 'DEBATING', color: 'var(--orange)' },
                { label: 'FIXING', color: 'var(--purple)' },
                { label: 'VERIFYING', color: 'var(--green)' },
                { label: 'COMPILING', color: 'var(--purple)' },
                { label: 'REPORTING', color: 'var(--gold)' },
                { label: 'WAITING_HUMAN', color: 'var(--gold)' },
              ].map((s, i, arr) => (
                <div key={i} style={{ display: 'contents' }}>
                  <div style={{ background: 'var(--bg)', border: `2px solid ${s.color}`, borderRadius: '8px', padding: '6px 12px', textAlign: 'center', minWidth: '80px' }}>
                    <div style={{ fontWeight: 700, fontSize: '10px', color: s.color }}>{s.label}</div>
                  </div>
                  {i < arr.length - 1 && <span style={{ color: 'var(--gold)', fontSize: '12px', fontWeight: 700 }}>→</span>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
              {[
                { label: 'FAILED', color: 'var(--red)' },
                { label: 'BLOCKED', color: 'var(--orange)' },
                { label: 'CANCELLED', color: 'var(--red)' },
                { label: 'BUDGET_STOPPED', color: 'var(--orange)' },
                { label: 'MODEL_UNAVAILABLE', color: 'var(--red)' },
              ].map((s) => (
                <div key={s.label} style={{ background: 'var(--bg)', border: `2px solid ${s.color}`, borderRadius: '8px', padding: '6px 12px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '10px', color: s.color }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '12px', color: 'var(--muted)' }}>
              WAITING_HUMAN: escalation, missing model, policy exception, Founder review. REPORTING ≠ closed.
            </div>
          </div>

          {/* Model Policy */}
          <SectionHead title="Model Policy — Tribunal Requirements" />
          <div style={{ background: 'var(--surface)', border: '1px solid var(--red)', borderRadius: '8px', padding: '20px' }}>
            <div style={{ fontSize: '13px', lineHeight: '1.8' }}>
              <div style={{ fontWeight: 700, color: 'var(--red)', marginBottom: '8px' }}>Model #2 (Gemini) MANDATORY for Tribunal</div>
              <div>• Orchestra CANNOT self-degrade to 2-model mode</div>
              <div>• If Gemini missing → Orchestra STOPS → MODEL_UNAVAILABLE → notifies Founder</div>
              <div>• Founder chooses: (A) wait for full model availability or (B) allow exception mode</div>
              <div>• If exception mode: artifact records <code>execution_mode: exception</code>, <code>missing_models</code>, <code>founder_override: true</code></div>
              <div>• CANNOT be labeled as "full standard tribunal" when running with missing model</div>
            </div>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB 2: API & CREDENTIALS
         ════════════════════════════════════════════════════════ */}
      {activeTab === 2 && (
        <>
          <div className="banner banner-warn" style={{ marginBottom: '20px' }}>
            v2.2: <code>missionchain_admin</code> = control plane, <code>mic-orchestra</code> = runtime engine + API. All 3 models are <strong>required</strong> for formal tribunal.
          </div>

          {/* Status Message */}
          {apiMsg && (
            <div style={{ padding: '10px 16px', marginBottom: '16px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, background: apiMsg.startsWith('Error') ? 'rgba(255,0,0,0.1)' : 'rgba(0,200,0,0.1)', color: apiMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>
              {apiMsg}
            </div>
          )}

          {/* Anthropic */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid var(--purple)', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={{ fontSize: '20px' }}>🎭</span>
              <span style={{ fontWeight: 700, fontSize: '15px' }}>Anthropic — Claude</span>
              <Badge variant="gold">Required</Badge>
              <Badge variant="purple">Orchestra + Coder + Synthesis</Badge>
              <div style={{ marginLeft: 'auto' }}>{getModelBadge(modelCheck?.claude)}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">API Key</label>
                <input className="form-input" type="password" placeholder="sk-ant-api03-..." value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)} />
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>ENV: ANTHROPIC_API_KEY — leave blank to keep current</span>
              </div>
              <div className="form-group">
                <label className="form-label">Primary Model</label>
                <select className="form-input" value={anthropicModel} onChange={e => setAnthropicModel(e.target.value)}>
                  <option value="claude-sonnet-4-20250514">Claude Sonnet 4 ($0.003/$0.015/1K)</option>
                  <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 ($0.001/$0.005/1K)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button className="btn btn-primary" onClick={() => handleSaveProvider('anthropic')} disabled={savingApi === 'anthropic'}>
                {savingApi === 'anthropic' ? 'Saving...' : 'Save Anthropic'}
              </button>
            </div>
          </div>

          {/* OpenAI */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid var(--green)', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={{ fontSize: '20px' }}>🔒</span>
              <span style={{ fontWeight: 700, fontSize: '15px' }}>OpenAI — Codex</span>
              <Badge variant="gold">Required</Badge>
              <Badge variant="active">Auditor #1 — Tribunal Required</Badge>
              <div style={{ marginLeft: 'auto' }}>{getModelBadge(modelCheck?.codex)}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">API Key</label>
                <input className="form-input" type="password" placeholder="sk-..." value={openaiKey} onChange={e => setOpenaiKey(e.target.value)} />
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>ENV: OPENAI_API_KEY — leave blank to keep current</span>
              </div>
              <div className="form-group">
                <label className="form-label">Primary Model</label>
                <select className="form-input" value={openaiModel} onChange={e => setOpenaiModel(e.target.value)}>
                  <option value="o1">o1 — Deep Reasoning ($0.015/$0.060/1K)</option>
                  <option value="gpt-4o">GPT-4o ($0.005/$0.015/1K)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button className="btn btn-primary" onClick={() => handleSaveProvider('openai')} disabled={savingApi === 'openai'}>
                {savingApi === 'openai' ? 'Saving...' : 'Save OpenAI'}
              </button>
            </div>
          </div>

          {/* Google */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: '3px solid var(--blue)', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={{ fontSize: '20px' }}>🌐</span>
              <span style={{ fontWeight: 700, fontSize: '15px' }}>Google — Gemini</span>
              <Badge variant="gold">Required for Tribunal</Badge>
              <Badge variant="active">Auditor #2 — Missing = Pipeline Stops</Badge>
              <div style={{ marginLeft: 'auto' }}>{getModelBadge(modelCheck?.gemini)}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="form-group">
                <label className="form-label">API Key</label>
                <input className="form-input" type="password" placeholder="AIzaSy..." value={googleKey} onChange={e => setGoogleKey(e.target.value)} />
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>ENV: GOOGLE_AI_API_KEY — leave blank to keep current</span>
              </div>
              <div className="form-group">
                <label className="form-label">Primary Model</label>
                <select className="form-input" value={googleModel} onChange={e => setGoogleModel(e.target.value)}>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash ($0.00015/$0.0006/1K)</option>
                  <option value="gemini-2.5-pro">Gemini 2.5 Pro ($0.00125/$0.010/1K)</option>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash ($0.0001/$0.0004/1K)</option>
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <button className="btn btn-primary" onClick={() => handleSaveProvider('google')} disabled={savingApi === 'google'}>
                {savingApi === 'google' ? 'Saving...' : 'Save Google'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button className="btn btn-outline" onClick={handleReload}>Reload from .env</button>
            <button className="btn btn-primary" onClick={fetchAll}>Check All Connections</button>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB 3: BUDGET & SCHEDULER
         ════════════════════════════════════════════════════════ */}
      {activeTab === 3 && (
        <>
          <div className="stat-grid">
            <StatCard label="Daily Budget" value={`$${dailyBudget}`} sub="Exhausted → BUDGET_STOPPED → notify Founder" color="gold" />
            <StatCard label="Monthly Budget" value={`$${monthlyBudget}`} sub="30-day rolling limit" color="purple" />
            <StatCard label="Chat Cost/Day" value="$0.05" sub="Planning estimate only" color="green" />
            <StatCard label="Full Audit Cost" value="$5-20" sub="Requires all 3 models" color="cyan" />
          </div>

          {/* Budget Controls */}
          <SectionHead title="Budget Controls" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
            <div className="form-group">
              <label className="form-label">Daily Budget (USD)</label>
              <input className="form-input" type="number" min={1} value={dailyBudget} onChange={e => setDailyBudget(Number(e.target.value))} />
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>ENV: ORCHESTRA_DAILY_BUDGET. Exhausted → BUDGET_STOPPED → will not auto-continue.</span>
            </div>
            <div className="form-group">
              <label className="form-label">Monthly Budget (USD)</label>
              <input className="form-input" type="number" min={10} value={monthlyBudget} onChange={e => setMonthlyBudget(Number(e.target.value))} />
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>ENV: ORCHESTRA_MONTHLY_BUDGET</span>
            </div>
          </div>

          {/* NLP Cost Tiers */}
          <SectionHead title="Cost and Degradation Policy" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginBottom: '24px' }}>
            {COST_TIERS.map(tier => (
              <div key={tier.tier} style={{
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px',
                borderLeft: `3px solid ${tier.color}`,
              }}>
                <div style={{ fontWeight: 700, fontSize: '13px', color: tier.color }}>{tier.tier}</div>
                <div style={{ fontSize: '12px', color: 'var(--muted)', margin: '4px 0' }}>{tier.method}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700 }}>{tier.cost}</span>
                  <span style={{ fontSize: '11px', color: 'var(--muted)' }}>{tier.coverage}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Scheduler */}
          <SectionHead title="Auto Audit Scheduler" />
          <DataTable
            columns={scheduleColumns}
            data={SCHEDULE_JOBS}
          />
          <div className="banner banner-warn" style={{ marginTop: '12px' }}>
            v2.2: Scheduler auto-checks model availability before running audit. Missing model → skipped → notifies Founder.
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
            <button className="btn btn-primary" onClick={handleSaveBudget} disabled={savingBudget}>
              {savingBudget ? 'Saving...' : 'Save Budget'}
            </button>
            <button className="btn btn-outline">Start Scheduler</button>
            <button className="btn btn-outline">Stop Scheduler</button>
            {budgetMsg && <span style={{ fontSize: '12px', color: budgetMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>{budgetMsg}</span>}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB 4: TELEGRAM & NOTIFICATIONS
         ════════════════════════════════════════════════════════ */}
      {activeTab === 4 && (
        <>
          <div className="stat-grid">
            <StatCard label="Bot Status" value="Online" sub="Telegram polling active" color="green" />
            <StatCard label="Languages" value="2" sub="Vietnamese + English auto-detect" color="purple" />
            <StatCard label="RBAC Roles" value="5" sub="Super • Finance • Content • Mod • KYC" color="gold" />
            <StatCard label="Admin Members" value="1" sub="Configurable via Admin Members tab" color="cyan" />
          </div>

          <SectionHead title="Telegram Bot Configuration" />
          {telegramMsg && (
            <div style={{ padding: '10px 16px', marginBottom: '12px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, background: telegramMsg.startsWith('Error') ? 'rgba(255,0,0,0.1)' : 'rgba(0,200,0,0.1)', color: telegramMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)' }}>
              {telegramMsg}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '12px' }}>
            <div className="form-group">
              <label className="form-label">Telegram Bot Token</label>
              <input className="form-input" type="password" placeholder="1234567890:ABCdef..." value={telegramToken} onChange={e => setTelegramToken(e.target.value)} />
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>ENV: TELEGRAM_BOT_TOKEN — leave blank to keep current</span>
            </div>
            <div className="form-group">
              <label className="form-label">Primary Chat ID (Super Admin)</label>
              <input className="form-input" placeholder="123456789" value={telegramChatId} onChange={e => setTelegramChatId(e.target.value)} />
              <span style={{ fontSize: '11px', color: 'var(--muted)' }}>ENV: TELEGRAM_CHAT_ID — Get from @userinfobot</span>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
            <button className="btn btn-primary" onClick={handleSaveTelegram} disabled={savingTelegram}>
              {savingTelegram ? 'Saving...' : 'Save Telegram Config'}
            </button>
          </div>

          {/* How to get Bot Token */}
          <SectionHead title="Telegram Bot Setup Guide" />
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '20px' }}>
            <div style={{ fontSize: '13px', lineHeight: '2' }}>
              <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: '8px' }}>Step 1: Create Bot Token</div>
              <div>1. Open Telegram → search <code>@BotFather</code></div>
              <div>2. Send <code>/newbot</code> → name your bot (e.g. MissionChain Orchestra)</div>
              <div>3. Copy token (format: <code>1234567890:ABCdefGHIjklMNOpqrsTUVwxyz</code>)</div>
              <div>4. Paste into <strong>Telegram Bot Token</strong> field above</div>

              <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: '8px', marginTop: '16px' }}>Step 2: Get Chat ID</div>
              <div>1. Open Telegram → search <code>@userinfobot</code></div>
              <div>2. Send <code>/start</code> → bot returns your Chat ID</div>
              <div>3. Paste into <strong>Primary Chat ID</strong> field</div>

              <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: '8px', marginTop: '16px' }}>Step 3: Add Admin Members (Multi-admin)</div>
              <div>1. Go to <strong>Core → Roles & Permissions</strong> tab or access <code>http://SERVER:3847</code></div>
              <div>2. Add member with Chat ID + Role</div>
              <div>3. ENV format: <code>ADMIN_USERS=chatId:ROLE:Name,chatId2:ROLE:Name2</code></div>

              <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: '8px', marginTop: '16px' }}>Step 4: Start Orchestra</div>
              <div>Server path: <code>/home/deploy/mic-orchestra/</code></div>
              <div><code>pm2 start ecosystem.config.js</code> → starts 3 processes:</div>
              <div style={{ paddingLeft: '16px' }}>
                <code>mic-commander</code> — NLP Telegram bot (ops-commander.js)<br/>
                <code>mic-scheduler</code> — Auto audit cron jobs (scheduler.js)<br/>
                <code>mic-settings</code> — Admin dashboard API :3847 (admin-settings-api.js)
              </div>
            </div>
          </div>

          {/* ENV Summary */}
          <SectionHead title="Environment Variables — Quick Reference" />
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '20px', fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: '2' }}>
            <div style={{ color: 'var(--gold)' }}># === REQUIRED (all 3 for tribunal) ===</div>
            <div>ANTHROPIC_API_KEY=sk-ant-api03-...</div>
            <div>OPENAI_API_KEY=sk-...</div>
            <div>GOOGLE_AI_API_KEY=AIzaSy... <span style={{ color: 'var(--muted)' }}># Required for tribunal</span></div>
            <div>TELEGRAM_BOT_TOKEN=1234567890:ABC...</div>
            <div>TELEGRAM_CHAT_ID=123456789</div>
            <br/>
            <div style={{ color: 'var(--gold)' }}># === BUDGET ===</div>
            <div>ORCHESTRA_DAILY_BUDGET=20</div>
            <div>ORCHESTRA_MONTHLY_BUDGET=300</div>
            <br/>
            <div style={{ color: 'var(--gold)' }}># === ADMIN ===</div>
            <div>ADMIN_USERS=chatId:ROLE:Name,...</div>
            <div>ADMIN_PASSPHRASE=&lt;set-a-unique-secret&gt;</div>
            <br/>
            <div style={{ color: 'var(--gold)' }}># === MODEL OVERRIDES ===</div>
            <div>CLAUDE_MODEL=claude-sonnet-4-20250514</div>
            <div>CODEX_MODEL=o1</div>
            <div>GEMINI_MODEL=gemini-2.5-flash</div>
            <div>NLP_MODEL=claude-haiku-4-5-20251001</div>
            <div>ADMIN_DIRECTIVE_MODEL=claude-sonnet-4-20250514</div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button className="btn btn-outline" onClick={handleReload}>Reload from .env</button>
          </div>
        </>
      )}
    </>
  );
}
