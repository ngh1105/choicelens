# ChoiceLens Product Spec

Date: 2026-05-18
Status: planning
Owner: project founder

## 1. Product Summary

ChoiceLens is a web app that helps users compare options, reduce too many choices
to a small shortlist, understand why one option fits them better, and track when a
better time to choose appears.

The product is intentionally broad. A user can compare phones, laptops, travel
stays, apps, courses, restaurants, services, or any set of links and names. The
first version should still feel focused: one input box, one guided preference
flow, one comparison result, and one optional watchlist.

GenLayer is used for consensus-backed decision reasoning, not for a marketplace,
escrow, prediction market, court, bounty, grant evaluator, or AI inference router.
This keeps the product distinct from visible GenLayer Portal projects such as
AntSeed, Proven, Internet Court, BuildersClaw, FUD.markets, GHBounty, Apolo, and
TreasuryPilot.

## 2. Target Users

Primary users:

- Everyday shoppers who want a clear recommendation before buying.
- Students and workers comparing tools, courses, apps, or devices.
- Travelers and local consumers comparing services or places.
- Families making shared purchasing decisions.
- Power users who save decision profiles and want recurring alerts.

Secondary users:

- Bloggers and creators who publish comparison pages.
- Small communities that want shared recommendation boards.
- Future API buyers who want embeddable comparison intelligence.

## 3. Core User Jobs

The product must support four jobs:

1. Compare quickly before choosing.
2. Reduce many options into a top 3 shortlist.
3. Explain which option fits the user's personal constraints.
4. Track saved choices for price, review, ranking, or availability changes.

## 4. Differentiation

Most comparison products are either SEO pages, affiliate lists, marketplace sort
filters, or a single chatbot answer. ChoiceLens should differentiate with:

- Personal preference memory across categories.
- Multi-perspective scoring instead of one generic answer.
- Transparent decision traces: what was considered, what was uncertain, and what
  would change the recommendation.
- Optional GenLayer-backed decision receipts for premium users.
- Watchlists that notify users when a recommendation changes.
- Bias controls that separate sponsored/affiliate results from organic reasoning.

## 5. Product Principles

- Broad input, narrow output: accept messy requests, return a small useful answer.
- Explain trade-offs, not only winners.
- Default to consumer language, not crypto language.
- Wallet should be optional in the recommended architecture.
- Never hide commercial bias. Affiliate links and sponsored placements must be
  labeled and excluded from core ranking unless the user opts in.
- Treat GenLayer consensus as a premium trust and portability layer, not a loading
  spinner on every free request.

## 6. Non-Goals

V1 will not be:

- An AI model provider marketplace.
- A prediction market.
- A legal court or dispute resolution protocol.
- A delivery escrow tool.
- A GitHub bounty platform.
- A DAO grant evaluator.
- A generic web oracle.
- A full browser extension.
- A mobile app.
- A full ecommerce checkout marketplace.

## 7. V1 Scope

### Must Have

- Web app landing directly into the comparison input.
- Guest usage without wallet.
- Account creation by email or social login.
- Optional wallet connection.
- Compare 2 to 10 manually entered options.
- Paste links for products, apps, services, courses, or places.
- Preference capture:
  - budget,
  - location or market,
  - must-have needs,
  - deal-breakers,
  - priority sliders such as price, quality, convenience, risk, durability.
- Multi-agent analysis:
  - value analyst,
  - fit analyst,
  - risk analyst,
  - evidence quality analyst,
  - long-term usefulness analyst.
- Shortlist and final recommendation.
- Watchlist for saved decisions.
- User history of comparisons.
- Shareable read-only result page.
- Freemium limits and paid subscription gates.
- Admin view for usage, errors, and GenLayer job cost.

### Should Have

- Import from search results or pasted table.
- Result regeneration with changed preferences.
- Decision receipt stored off-chain, with optional GenLayer transaction hash.
- Basic multilingual UI architecture, starting with English and Vietnamese-ready
  copy structure.
- Stripe subscription or equivalent fiat billing.
- Wallet-based premium proof for users who prefer crypto-native ownership.

### Later

- Browser extension.
- Mobile app.
- Public comparison library.
- Team/family boards.
- API plan.
- White-label widgets.
- Creator publishing tools.

## 8. User Experience

### Primary Flow

1. User enters a request:
   - "Compare these 5 laptops for video editing under $1,500."
   - "Which AI note-taking app should I use for university?"
   - "Choose between these hotels for a quiet family trip."
2. App asks only the missing high-impact questions.
3. App gathers source material from pasted links, user text, public metadata, and
   optional search providers.
4. App runs local/off-chain analysis for speed.
5. Premium or high-confidence requests can trigger GenLayer consensus.
6. Result returns:
   - top pick,
   - top 3 shortlist,
   - scoring table,
   - personal fit explanation,
   - risks and unknowns,
   - what would change the answer,
   - save/watch action.
7. User can save to watchlist and receive alerts.

### Result Page Structure

- Recommendation header.
- Short answer in one paragraph.
- Top 3 comparison table.
- "Why this fits you" section.
- "Trade-offs" section.
- "Avoid if" warnings.
- Evidence confidence section.
- Watchlist controls.
- Optional receipt details.

## 9. Revenue Model

### Free

- Limited monthly comparisons.
- Limited saved watchlist items.
- Basic result pages.

### Plus Subscription

- Higher comparison limits.
- Personalized profile memory.
- Watchlist alerts.
- GenLayer-backed decision receipts for selected decisions.
- Private saved comparisons.

### Pro Subscription

- Bulk option import.
- Advanced scoring weights.
- Export to PDF/CSV.
- Shared boards for family or small teams.
- Priority GenLayer consensus jobs.

### Future API

- Paid API usage for comparison widgets and partner apps.

### Affiliate Revenue

Affiliate links can be added only if clearly labeled. The ranking engine must not
prefer affiliate items by default. A separate "commercial opportunity" pipeline can
exist, but core recommendation integrity must remain independent.

## 10. GenLayer Usage Model

GenLayer should be used where consensus matters:

- Final decision receipt for paid users.
- Stored scoring snapshot for later comparison.
- Multi-perspective evaluation where validators can reason over subjective
  criteria.
- Watchlist trigger decisions when source conditions materially change.

GenLayer should not be used for:

- Every keystroke.
- Cheap free-tier drafts.
- Raw web crawling at large scale.
- Private user data that should stay off-chain.
- Payment subscription state when normal billing infrastructure is simpler.

## 11. High-Level Architecture Options

Three architecture options are documented:

1. Web2-first, wallet-optional.
2. Wallet-first DApp.
3. API-first comparison engine.

The recommended option is Web2-first, wallet-optional because it fits broad
consumer adoption while preserving an upgrade path into wallet identity,
GenLayer-backed receipts, and future API revenue.

## 12. Data Model

### User

- id
- email or auth provider id
- optional wallet addresses
- plan
- locale
- created_at

### PreferenceProfile

- user_id
- category defaults
- budget patterns
- priority weights
- excluded brands or deal-breakers
- privacy settings

### ComparisonRequest

- id
- user_id or guest_session_id
- prompt
- category
- market
- input_options
- preference_snapshot
- status
- created_at

### Option

- id
- request_id
- name
- url
- normalized_metadata
- source_snapshot

### AnalysisRun

- id
- request_id
- model/provider metadata
- agent_scores
- final_scores
- recommendation
- confidence
- uncertainty_notes
- cost
- status

### GenLayerReceipt

- id
- request_id
- contract_address
- transaction_hash
- network
- finality_status
- receipt_payload_hash
- created_at

### WatchlistItem

- id
- user_id
- request_id
- tracked_options
- tracked_signals
- alert_rules
- last_checked_at
- last_recommendation_hash

## 13. Security and Privacy

- Store only the preference data needed to improve future decisions.
- Hash receipt payloads before anchoring or referencing them on-chain.
- Do not put private prompts, personal constraints, or hidden profile data on-chain.
- Encrypt sensitive saved preference fields at rest.
- Use row-level authorization checks for all user-owned records.
- Rate-limit comparison and watchlist endpoints.
- Add abuse detection for automated scraping or prompt injection.
- Treat pasted pages as untrusted content.
- Show clear disclaimers for health, finance, legal, and safety-related decisions.

## 14. Testing Strategy

### Product Tests

- Input parsing for messy requests.
- Preference question generation.
- Result structure consistency.
- Watchlist state changes.
- Subscription limit behavior.

### GenLayer Tests

- Local contract unit tests with mocked web/LLM responses.
- Studio/testnet integration tests for consensus behavior.
- Transaction receipt polling.
- Error states for pending, accepted, finalized, failed, and timeout.
- Contract upgrade/migration test cases.

### Frontend Tests

- Core flows with Playwright.
- Mobile and desktop layout checks.
- Wallet connected and wallet disconnected states.
- Empty, loading, error, and partial result states.

### Backend Tests

- API contract tests.
- Queue retry tests.
- Cost guardrail tests.
- Auth and permission tests.

## 15. Production Readiness Bar

The product is production-ready only when:

- Users can complete comparisons without wallet friction.
- Paid users can connect wallet and create receipts reliably.
- Failed GenLayer jobs degrade gracefully to off-chain results.
- Billing, limits, cancellation, and invoices work.
- Admins can inspect failed jobs and user-impacting errors.
- Logs do not expose private prompt content unnecessarily.
- Watchlist alerts are accurate, rate-limited, and user-configurable.
- Security review covers auth, wallet signing, prompt injection, data leakage, and
  subscription abuse.

## 16. Open Product Decisions

- Final product name and brand.
- Whether V1 starts with all categories or guided category templates.
- First paid plan prices.
- Whether affiliate monetization is enabled at launch or delayed.
- Which GenLayer network is used for public beta.
- Whether wallet-based auth uses SIWE in V1 or after V1.

## 17. References

- GenLayerJS official documentation: https://docs.genlayer.com/api-references/genlayer-js
- GenLayer DApp architecture overview: https://docs.genlayer.com/developers/decentralized-applications/architecture-overview
- GenLayer Intelligent Contracts introduction: https://docs.genlayer.com/developers
- GenLayer first Intelligent Contract guide: https://docs.genlayer.com/developers/intelligent-contracts/first-intelligent-contract
- GenLayer testing guide: https://docs.genlayer.com/developers/intelligent-contracts/testing
- RainbowKit installation docs: https://rainbowkit.com/en-US/docs/installation
- wagmi official site: https://wagmi.sh
- viem official docs: https://viem.sh/docs/getting-started

