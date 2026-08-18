---
name: listing-kit
description: "How to assemble a CoinMarketCap / CoinGecko listing application kit for Mission Chain — logo, description, official links, contract address, social proof, and a readiness checklist. Use when preparing an exchange/aggregator listing submission or checking listing readiness. Invoked by the analytics-agent."
---

# Listing Kit — Mission Chain (CoinMarketCap / CoinGecko)

Assemble accurate, consistent listing applications and track readiness.

## Fields to gather
- **Project:** name (Mission Chain), one-line + long description (NO returns/ROI language), category, **jurisdiction = USA** (not Vietnam).
- **Token:** MIC, chain BSC (chainId 56), contract address (copy exactly from the verified deployment), decimals, total supply 1,050,000,000.
- **Links:** website (missionchain.io), app (app.missionchain.io), whitepaper, BSCScan (verified), and the **active social channels** (X, Telegram, YouTube, TikTok).
- **Social proof:** aggregators gate on active channels + community size — supply follower/member counts and activity evidence.

## Readiness checklist (met vs pending)
- [ ] Verified contract on BSCScan (met — 21 verified)
- [ ] Active X + Telegram with recent posts + community
- [ ] Public whitepaper synced to current model (SEED V5c 4-slot)
- [ ] Consistent jurisdiction/links across all official surfaces
- [ ] No returns/securities language anywhere in the submission

## Output
`_workspace/E_analytics_listing-kit.md` — per-aggregator field set + readiness checklist (met/pending + what's needed).

## Rule
Do not submit an incomplete application — list pending prerequisites with what's needed. Description passes the same compliance check (no returns, USA jurisdiction).
