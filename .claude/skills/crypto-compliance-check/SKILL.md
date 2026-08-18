---
name: crypto-compliance-check
description: "How to compliance-review Mission Chain marketing assets before publish — securities/ROI language, FTC referral disclosure, US-jurisdiction accuracy, platform crypto rules (esp. TikTok), faith integrity, factual sourcing. Use before publishing ANY Mission Chain marketing asset. Invoked by the compliance-reviewer agent. Verdict: PASS / FIX / REDO / ESCALATE."
---

# Crypto Compliance Check — Mission Chain Publish Gate ⛔

Review every asset before publish (publishing is irreversible). Output a verdict + cited rule + fix instructions.

## Checklist (reject on any hit)
1. **Returns/securities:** no ROI, profit, "investment", guaranteed-outcome, or up-only framing. SEED = strategic-partner grant, jurisdiction **USA** — avoid unregistered-securities-solicitation risk (Howey). → REDO/ESCALATE.
2. **FTC disclosure:** referral/affiliate promotion (Direct Referral F1 7% / Indirect Referral F2 3%) carries clear #ad/disclosure. → FIX.
3. **Disclaimer:** "not financial advice" where token economics are discussed. → FIX.
4. **Jurisdiction:** project based in USA (not Vietnam = founder's personal residence). → FIX/REDO.
5. **Platform rules:** TikTok = organic-only + extra-conservative on financial-advice/returns; X/YouTube/Telegram honor each platform's financial-product policy; no misleading claims. → FIX/REDO.
6. **Faith integrity:** no exploitative / prosperity-gospel framing using faith to pressure purchase. → REDO/ESCALATE.
7. **Factual sourcing:** token numbers, addresses, dates must be sourced/verified; unsourced financial figures → REDO.

## Verdicts
- **PASS** — safe to publish.
- **FIX** — specific edits required (cite rule + exact change).
- **REDO** — fundamentally non-compliant; rewrite from brief.
- **ESCALATE** — borderline securities/faith/jurisdiction → stop, ask the Owner.

## Principle
Default to caution. Uncertain about a securities or faith line → ESCALATE, never PASS. Cite the specific rule for every FIX/REDO so one pass fixes it.

## Output
`_workspace/C_compliance_{asset-id}.md` — verdict + rule + instructions. Only PASS (or Owner-approved ESCALATE) proceeds.
