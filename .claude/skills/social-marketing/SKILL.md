---
name: social-marketing
description: "Runs Mission Chain's social media & marketing production as a coordinated agent team. Use this for ANY Mission Chain marketing/social request — plan a campaign, write X/Twitter posts & threads, Telegram announcements, YouTube/audio scripts, TikTok short-form; localize to VI/ES/PT/KO; compliance-review before publish; schedule/distribute; measure results; assemble CoinMarketCap/CoinGecko listing kits. Triggers on: 'marketing', 'social', 'social media', 'campaign', 'content calendar', 'post', 'thread', 'tweet', 'X post', 'Telegram announcement', 'TikTok', 'short video', 'YouTube script', 'listing kit', 'CMC/CoinGecko', 'announcement', 'awareness'. ALSO triggers on follow-ups: 'run again', 're-run', 'update the campaign', 'redo the {post/thread/video}', 'improve the result', 'based on the previous result', 'next week's content'. Vietnamese triggers: 'marketing', 'truyền thông', 'chiến dịch', 'nội dung', 'bài đăng', 'lịch nội dung', 'đăng bài', 'video ngắn', 'kịch bản', 'niêm yết'. Simple factual questions may be answered directly without the full team."
---

# Social Marketing Orchestrator — Mission Chain

Coordinates the Mission Chain marketing agent team through a **Hybrid** workflow. It weaves the eight specialist agents and their skills into one pipeline with a mandatory compliance gate. This skill defines *who collaborates when and in what order*; the individual agent skills define *how each does its part*.

**Execution mode: Hybrid** — team for strategy & engagement, fan-out for production, Producer-Reviewer for the gate, sub for measurement. Each Phase below names its mode.

> Agent Teams (`TeamCreate`/`SendMessage`/`TaskCreate`) require `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. If unset, run the same phases sequentially via the `Agent` tool (sub-agent fallback) — the workflow and gate are identical; only the coordination mechanism differs. Always pass `model: "opus"`.

## Phase 0: Context Check (initial vs follow-up vs partial re-run)

Before anything, decide the run mode from `_workspace/`:
- No `_workspace/` → **initial run** (start Phase A).
- `_workspace/` exists + user asks a partial change ("redo the TikTok cut", "fix the ES thread") → **partial re-run**: re-invoke only the relevant agent(s), keep the rest.
- `_workspace/` exists + user gives a new brief/goal → **new run**: move existing `_workspace/` to `_workspace_prev/`, then start fresh.

## Phase A: Strategy — *team*
Leader forms the strategy team: `market-strategist` (+ `brand-guardian`, `analytics-agent` for context). Strategist produces `A_strategist_campaign-brief.md` + `A_strategist_calendar.md`. Analytics feeds last-cycle insights if `_workspace_prev/` exists.

## Phase B: Production — *fan-out (team)*
Tear down Phase A team; form the production team. For each asset in the calendar, run in parallel:
- `content-writer` → EN copy (`B_writer_{id}.md`)
- `localizer` → VI/ES/PT/KO (`B_localizer_{id}_{lang}.md`)
- `visual-designer` → image/short-video concept (`B_visual_{id}.md`)

Members self-coordinate: writer → localizer (locked terms), writer → visual (intent). Repurpose YouTube/audio into TikTok/Shorts cuts here.

## Phase C: Compliance & Brand Gate — *Producer-Reviewer (team)* ⛔
Every asset MUST clear both gate agents before Phase D:
- `compliance-reviewer` → `C_compliance_{id}.md` (PASS / FIX / REDO / ESCALATE)
- `brand-guardian` → `C_brand_{id}.md` (PASS / FIX)

FIX loops back to the producing agent (max 2 cycles → REDO). **ESCALATE (returns/securities framing, borderline faith imagery, jurisdiction) → stop and ask the Owner.** No asset proceeds without both PASS.

## Phase D: Publish & Engage — *team*
`community-manager` distributes PASS'd assets per channel (X/Telegram/YouTube/TikTok), coordinates NIRA engagement, runs anti-impersonation hygiene. Outputs `D_community_publish-log.md` + `D_community_sentiment.md`.

## Phase E: Measure & Evolve — *sub*
`analytics-agent` measures, writes `E_analytics_insights.md`, and (on request) `E_analytics_listing-kit.md` for CMC/CoinGecko. Insights feed the next Phase A cycle. Record any agent/skill/calendar change in the CLAUDE.md change log.

## Data Handoff Protocol
- **File-based** (source of truth): all intermediate artifacts in `_workspace/`, named `{phase}_{agent}_{artifact}.{ext}`.
- **Task-based**: `TaskCreate` per calendar asset with dependencies (produce → gate → publish).
- **Message-based**: real-time corrections during the gate loop.
- Preserve `_workspace/` after completion (audit trail); only final assets go to the user/publish channels.

## Error Handling
- Retry a failed agent once; on repeat failure, proceed without that asset and note the omission in the report — never publish an ungated asset to fill the gap.
- Never delete conflicting outputs; annotate with source.
- Any compliance ESCALATE halts that asset pending Owner decision.

## Team Size
Keep 3–5 focused members active per phase (see harness team-size guidance). Reconfigure the team between phases rather than running all eight at once.

## Test Scenarios
- **Normal:** "Plan next week's Mission Chain content for X and TikTok about our verified contracts" → Phase A calendar → B produces EN+localized+short-video → C gate PASS → D schedule → E measure.
- **Error/ESCALATE:** an asset drafts "earn guaranteed returns with SEED" → compliance-reviewer REDO + ESCALATE → orchestrator halts, asks Owner, does not publish.
- **Partial re-run:** "redo just the Korean version of the tokenomics thread" → Phase 0 detects `_workspace/`, re-invokes localizer only, re-gates that asset.
