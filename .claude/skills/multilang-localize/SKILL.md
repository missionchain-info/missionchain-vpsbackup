---
name: multilang-localize
description: "How to localize Mission Chain marketing copy into VI/ES/PT/KO while keeping locked Glossary terms untranslated and preserving message/number parity. Use when translating or adapting any Mission Chain content across languages. Invoked by the localizer agent; shares the glossary discipline of the content-sync harness."
---

# Multilang Localize — Mission Chain VI/ES/PT/KO

Adapt EN-canonical copy per market. Localization ≠ literal translation — adapt idiom/register, keep meaning and numbers identical.

## Locked terms — NEVER translate (any language)
`Mission Chain, MIC, MICE, MFP-NFT, NIRA, SOPHIA, DAO, USDT, Web3, F1/F2, Builder/Maker/Luminary NFT, SEED, Pre-Sale, Early Bird, Founding Partner, Direct Referral (F1), Indirect Referral (F2)`.
- Referral labels stay `Direct Referral (F1)` / `Indirect Referral (F2)` in every language — NEVER "Blessing / Bendición / Bênção / 축복 / Phước lành".
- Tagline: use the established localization (VI: "Khởi nguồn từ Đức Tin. Kiến tạo vì Con Người."), not an ad-hoc re-translation.

## Method
1. Translate meaning + tone per market; restructure sentences around locked terms rather than translating them.
2. Copy numbers/dates/addresses exactly (a mistranslated figure is a compliance risk).
3. Apply local convention (e.g. ES comma convention) without changing value.
4. Write a one-line parity note: locked terms preserved + message unchanged.

## Output
`_workspace/B_localizer_{asset-id}_{lang}.md` for each of vi/es/pt/ko.

## Escalate
If an EN sentence is ambiguous → ask content-writer to disambiguate, don't guess.
