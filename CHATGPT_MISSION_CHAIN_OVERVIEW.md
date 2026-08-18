# Mission Chain — ChatGPT Project Overview

This document is a compact orientation file for ChatGPT or any AI assistant that needs to understand the Mission Chain project quickly and accurately.

## 1. What Mission Chain Is

Mission Chain is a faith-aligned Web3 ecosystem designed for creators, builders, churches, and community leaders.

Its core purpose is to create a **Creator Mission Economy** in which:

- verified contribution matters more than speculation
- value is returned to creators and communities instead of being extracted by centralized platforms
- participation, credentials, work, rewards, and governance can be tracked transparently on-chain

Mission Chain is not just a token project. It is intended to become a full-stack ecosystem combining:

- education
- creator work and services
- community and governance
- digital credentials
- tokenized incentives
- mission-driven social coordination
- eventually a dedicated Layer 2 network

## 2. Core Vision

Mission Chain is built around the idea that the digital economy should reward:

- learning
- verified work
- contribution
- stewardship
- community participation

The project is explicitly framed as **human-centered**, **faith-inspired**, and **anti-extractive**.

The long-term goal is to make **MIC** the native economic coin of **Mission Network Layer 2**, a future blockchain infrastructure purpose-built for the Creator Mission Economy.

## 3. Ecosystem Structure

Mission Chain has three foundational pillars:

### Mission Learn

The education pillar.

Purpose:

- train creators, builders, and community participants
- verify learning outcomes
- create portable, on-chain proof of skill

Typical outputs:

- course completion
- skill verification
- portfolio development
- eligibility for higher ecosystem participation

### Mission Work

The marketplace and economic activity pillar.

Purpose:

- connect verified creators with clients
- enable MIC-denominated work and service payments
- support creator income, licensing, and project delivery

Typical functions:

- job matching
- work delivery
- creator-client interaction
- escrow-style settlement logic
- ratings, reputation, and work history

### Mission Social

The community, showcase, and governance-activation pillar.

Purpose:

- create belonging and identity inside the ecosystem
- make contribution visible
- connect digital participation with real community life

Typical functions:

- creator profiles and public presence
- community engagement
- event and Hub participation
- governance signaling and community progression

## 4. Mission World

**Mission World** is the first community platform built on top of the three pillars.

Important distinction:

- Mission World is **not** a fourth pillar
- it is the first concrete platform where Mission Learn, Mission Work, and Mission Social come together

Mission World is intended to serve as a lived community layer for Christian creators and mission-driven participants.

Its sample/front-end concept in the repo includes:

- creator-focused landing experience
- community storytelling
- content/media discovery
- challenges and competitions
- creator opportunities
- faith-centered engagement experience

Public reference:

- `missionchain.world`

## 5. Main Economic Components

### MIC

**MIC** is the universal coordination token of the ecosystem.

Role of MIC:

- medium of exchange inside the ecosystem
- staking asset
- governance activation asset
- settlement asset for platform activities
- future native coin of Mission Network Layer 2

Current supply model in the docs/contracts:

- hard cap: `7,000,000,000 MIC`
- `15%` pre-issued at deployment
- `85%` emitted progressively via the emission engine

### MICE

**MICE** is a time-bound network participation credential, not a simple investment token.

Key characteristics:

- fixed max supply in the docs: `100,000`
- valid for `360 days` from activation
- sold in 5 fixed pricing rounds
- activation uses `50% USDT + 50% MIC`
- MIC portion is burned
- USDT portion is routed through protocol allocation rules

MICE is part of the mining / participation economy, not just a membership badge.

### MFP-NFT

**MFP-NFT** means Mission Founders Pass.

Role:

- constitutional stewardship credential
- governance credential for foundational protocol decisions

MFP-NFT alone does not fully activate power. Governance also requires qualifying MIC stake under the project’s approved governance rule.

### Community NFTs

These are earned contribution credentials:

- Builder
- Maker
- Luminary

They are not supposed to be bought directly from the protocol as governance rights.

They represent verified contribution and may unlock designated ecosystem benefits, recognition, and some program eligibility.

## 6. Governance Model

Mission Chain uses a multi-layer governance model under the umbrella of **Mission DAO**.

High-level idea:

- governance should be earned, not merely bought
- NFT credential type determines governance tier
- MIC stake determines actual weight / activation

Conceptual governance tiers in the public docs:

### Constitutional Layer

- driven by eligible MFP-NFT stewards with qualifying MIC stake
- handles framework-level parameters
- examples: emission coefficients, MICE bands, protected percentages

### Product / Strategic Layer

- broader participation from higher community roles and MFP holders
- handles product and platform-level parameters

### Community Layer

- broader community participation for local or operational issues
- advisory and program-oriented rather than constitutional

Important principle:

- no qualifying stake = no active governance weight

## 7. Canonical Language / Framing

Mission Chain’s public-facing language matters a lot.

The project tries to avoid culturally harmful MLM-style framing in external communication, especially in Christian community contexts.

For AI-generated communication, prefer this business/cultural framing:

- `Mission Ambassador Program`
- `Harvest Blessing`
- `Multiplication Blessing`
- `Community Growth Award`
- `Mission Invite`

Avoid presenting the system publicly with language like:

- downline / upline
- MLM
- referral commission as the primary story

Important implementation note:

- some code, route names, database entities, or internal files may still use the word `referral`
- but canonical public messaging should follow the mission/faith framing above

## 8. Public Web Properties

The project currently spans multiple public surfaces:

### 1. `missionchain.io`

Public website and documentation hub.

Contains:

- brand presentation
- project overview
- white paper
- glossary
- appendices
- multilingual documentation

### 2. `app.missionchain.io`

The user-facing Web3 application / DApp.

Primary role:

- wallet-connected participation layer
- stats, auth, dashboard, token, staking, mining, NFT, network, and governance access

### 3. `admin.missionchain.io`

Operational admin interface.

Primary role:

- internal management
- governance operations
- founder/seed/admin workflows
- exports and data oversight

### 4. `missionchain.world`

Community platform / Mission World surface.

Primary role:

- community narrative
- creator-facing worldbuilding
- eventually the first full expression of the three-pillar experience

## 9. Platform Functions — Practical Breakdown

This section is the most important one for ChatGPT when reasoning about product features.

## 9.1 Public Documentation Layer

The public website includes:

- website landing pages
- White Paper
- Glossary of Brand Terms
- Appendices
- multilingual routing for major documents
- light/dark presentation modes in documentation

Purpose:

- explain the ecosystem
- preserve brand terminology
- synchronize legal/economic narrative across languages

The glossary is especially important because many official terms should remain in English even in translated materials.

## 9.2 DApp / User Platform (`app.missionchain.io`)

The user platform is a Next.js-based Web3 frontend with wallet authentication and API-backed data.

Core observed functions from the repo:

### Wallet authentication

- connect wallet
- request nonce from API
- sign message
- verify signature
- receive JWT
- redirect authenticated member to dashboard

### Public token / ecosystem dashboard

- MIC price
- total supply
- pre-issued amount
- mining pool size
- circulating supply
- total staked
- total burned
- total emitted
- MFP minted
- community NFT counts
- active MICE count
- total users

### Token utility access

- link to smart contract
- add MIC token to wallet
- token visibility in the UI

### Staking

Observed backend support includes:

- global staking stats
- user staking positions
- time-lock tiers
- weighted staking
- estimated APY
- reward lookup / pending reward support

Time-lock model in code:

- 30 days
- 90 days
- 180 days
- 360 days

### Mining

Observed backend support includes:

- mining overview
- emission engine stats
- user mining rewards
- emission curve data for charts
- active MICE counts
- daily emission factors

### NFTs

Observed platform intent includes:

- Community NFT tracking
- MFP-NFT support
- tier recognition
- governance eligibility context

### Vesting

There is backend support for vesting routes, meaning the platform is designed to show users locked/unlocked token state and distribution timing.

### Mission Ambassador / network features

Even where internal code still uses `referral`, the platform includes:

- inviter / referrer relationships
- F1 / F2 network data
- commission / blessing history
- group volume logic
- network tree views
- status / rank progression

### Governance

Observed backend support includes:

- governance status
- council membership checks
- treasury/funds distribution reads
- claim information
- governance-related records

### P2P marketplace

Observed backend support includes:

- listing active orders
- single order reads
- seller order history
- buyer order history
- pre-flight validation
- KYC gate support

The current implementation appears focused first on **MFP-related P2P trading**, not a general full marketplace for every asset type.

### User system

The platform also includes:

- user registration
- user records in database
- auth state
- wallet-based identity
- role-aware access controls

## 9.3 Admin Platform (`admin.missionchain.io`)

The admin app is a separate Next.js application.

Observed/admin-referenced areas include:

- login / auth gate
- stats redirect
- founder allocation management
- MFP access section
- old investor section
- steward council management
- export functionality
- seed budget / operational pool workflows

Related backend route groups include:

- `/admin`
- `/admin/distributors`
- `/admin/seed/old-investors`
- `/admin/founders`
- `/admin/steward-council`
- `/admin/seed-budget/operational`

Practical admin responsibilities likely include:

- reviewing investor/founder allocation records
- managing operational treasury workflows
- recording governance-related admin actions
- exporting internal data
- synchronizing selected on-chain and off-chain states

## 9.4 API Layer (`api.missionchain.io`)

The backend is a Fastify API.

Main responsibilities:

- auth
- database access
- blockchain integration
- event indexing
- admin workflows
- dashboard aggregation
- governance reads/writes
- synchronization between chain state and application state

Observed API route domains:

- `auth`
- `user`
- `dashboard`
- `sales`
- `staking`
- `mining`
- `nft`
- `referral`
- `vesting`
- `dao`
- `admin`
- `distributor`
- `founders`
- `old-investors`
- `steward-council`
- `operational-pool`
- `governance`
- `p2p`
- `rounds`
- `menu-config`
- `nira-avatar`
- `network`
- `components`
- `telegram`

Observed service responsibilities:

- blockchain reads
- event indexer
- PreSale event sync
- SeedSale event sync
- P2P event sync
- mailer
- founder relayer
- old investor relayer
- on-chain admin writes
- spreadsheet / XLSX export builder

This means the API is not just a CRUD server. It is an orchestration layer between:

- frontend apps
- database
- wallets
- smart contracts
- event synchronization workers
- operational back-office tasks

## 10. Smart Contract / Protocol Scope

The deploy monorepo describes a broad smart contract system including:

- MIC token
- lock manager
- seed sale
- pre-sale
- MICE license
- emission controller
- mining pool
- staking
- MFP NFT
- community NFT
- revenue router
- seed budget
- reward distribution modules
- liquidity pool
- treasury manager
- DAO governor

In practical terms, the protocol is meant to govern:

- token supply and minting
- vesting / transfer restrictions
- sale logic
- participation credentials
- mining emission
- staking
- treasury routing
- governance execution
- reward distribution

## 11. Authentication and Identity Model

Mission Chain primarily uses **wallet-based authentication**.

High-level auth flow:

1. user connects a wallet
2. backend issues a nonce
3. user signs the message
4. backend verifies the signature
5. backend issues JWT for app access

This means identity is built around:

- wallet ownership
- role in database
- on-chain/off-chain participation state

## 12. Data / State Model

The platform is hybrid:

- some truth lives on-chain
- some truth lives in the database
- some views are computed by combining both

Examples:

- token balances and certain allocations are read from chain
- user membership, app records, rankings, and admin history live in DB
- dashboard views combine contract state + user records + event-indexed tables

This is important for AI reasoning:

- not everything is purely on-chain
- not everything is purely off-chain
- many business views are aggregated projections

## 13. Technical Stack

Observed stack in the repo:

- public website: static HTML/CSS/JS
- DApp frontend: Next.js
- admin frontend: Next.js
- API: Fastify
- DB layer: Prisma
- blockchain interaction: ethers / SDK / event sync services
- infrastructure: Docker Compose
- services: Postgres, Redis, nginx-based web serving

The repository also contains a deploy workspace that has been standardized for source-based container builds.

## 14. Current Strategic Direction

At a high level, Mission Chain is moving toward:

- a stronger public website and documentation layer
- a more structured application platform
- backend/API maturity
- smart contract rollout
- governance tooling
- mission/community platform growth

The website and application are related but distinct:

- `missionchain.io` = public website and canonical documentation
- `app.missionchain.io` = application layer / DApp
- `admin.missionchain.io` = internal/admin operations
- `missionchain.world` = community platform expression

## 15. How ChatGPT Should Think About Mission Chain

When helping on this project, ChatGPT should treat Mission Chain as:

- a mission-driven creator ecosystem
- a product suite, not just a token
- a hybrid Web3 + platform + community + governance system
- a multilingual public documentation project
- a brand-sensitive project where terminology matters
- a staged rollout where some modules are live, some are partially implemented, and some are roadmap items

ChatGPT should keep these distinctions clear:

- **MIC** = token / economic medium / future native coin
- **MICE** = participation credential with time-bound activation
- **MFP-NFT** = constitutional stewardship credential
- **Community NFTs** = earned contribution credentials
- **Mission World** = first platform built on top of the three-pillar architecture
- **Mission Learn / Work / Social** = foundational pillars, not merely page names

## 16. Recommended Default Framing for Future AI Conversations

If ChatGPT needs a compact one-paragraph explanation, use:

> Mission Chain is a faith-aligned Web3 creator ecosystem that combines education, creator work, community participation, on-chain credentials, staking, governance, and mission-driven economic coordination. Its public website (`missionchain.io`) is the documentation and brand layer, its DApp (`app.missionchain.io`) is the wallet-connected participation platform, its admin system (`admin.missionchain.io`) is the internal operations layer, and Mission World (`missionchain.world`) is the first community platform built on top of the ecosystem’s three pillars: Mission Learn, Mission Work, and Mission Social. MIC is the core token, MICE is a time-bound participation credential, MFP-NFT is the constitutional governance credential, and Builder/Maker/Luminary are earned Community NFTs for verified contributors.

## 17. Important Caution for AI Assistants

Before making hard claims, ChatGPT should check whether the question is about:

- public narrative / white paper positioning
- current application behavior
- backend implementation reality
- contract specification / planned protocol behavior

Those are related, but they are not always identical.

Example:

- the public website may describe the ideal ecosystem vision
- the API may expose only part of that vision today
- the contracts may be partially implemented or still evolving

So the safe approach is:

- distinguish between **canonical narrative**
- **current codebase behavior**
- **planned smart contract architecture**

## 18. File Use Guidance

Use this file as:

- onboarding context for ChatGPT
- a primer before discussing backend, smart contracts, product design, documentation, or governance
- a grounding document before generating specs, prompts, or implementation plans

