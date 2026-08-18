---
name: brand-consistency
description: "How to check Mission Chain marketing assets for brand voice, tagline, locked Glossary terms, and cross-language term parity before publish. Use as the brand co-gate alongside compliance. Invoked by the brand-guardian agent. Verdict: PASS / FIX."
---

# Brand Consistency — Mission Chain

Co-gate with compliance (compliance = legal risk; brand = voice/terms). Output PASS or FIX with specific corrections.

## Check
1. **Tagline verbatim:** "Born of Faith. Built for People." (VI: "Khởi nguồn từ Đức Tin. Kiến tạo vì Con Người.")
2. **Locked Glossary terms** present & untranslated/unparaphrased: `Mission Chain, MIC, MICE, MFP-NFT, NIRA, SOPHIA, DAO, USDT, Web3, F1/F2, Builder/Maker/Luminary NFT, SEED, Pre-Sale, Early Bird, Founding Partner, Direct Referral (F1), Indirect Referral (F2)`.
3. **Retired wording absent:** never "Blessing / Bendición / Bênção / 축복 / Phước lành" — always `Direct Referral (F1)` / `Indirect Referral (F2)`.
4. **NFT tiers** are Builder / Maker / Luminary (not Silver/Gold).
5. **Cross-language parity:** locked terms identical across EN/VI/ES/PT/KO; message unchanged.
6. **Tone:** faith-rooted, people-first, credible, calm — no hype-bro, no pressure, no exploitation.

## Principle
Consistency compounds trust; drift erodes the faith-and-credibility positioning that differentiates MC. Give concrete FIX instructions, not vague "more on-brand".

## Output
`_workspace/C_brand_{asset-id}.md` — `Verdict: PASS|FIX` + term/tone corrections.
