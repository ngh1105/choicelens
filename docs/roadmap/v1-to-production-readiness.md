# V1 to Production Readiness Roadmap

Date: 2026-05-18
Status: planning

## 1. Phase Overview

The roadmap is split into seven phases:

1. Foundation docs and decisions.
2. V1 prototype.
3. GenLayer integration beta.
4. Monetization beta.
5. Private beta.
6. Public launch.
7. Production hardening.

## 2. Phase 0: Foundation Docs and Decisions

Goal: turn the idea into a buildable product definition.

Deliverables:

- Product spec.
- Architecture decision.
- SDK integration plan.
- Data model draft.
- Intelligent Contract boundary.
- Monetization plan.
- Risk register.
- Implementation backlog.

Exit criteria:

- One architecture is selected.
- V1 scope is frozen.
- GenLayer network target is selected for beta.
- Project repository has docs committed.

## 3. Phase 1: V1 Prototype

Goal: prove that users can get a useful answer from a normal web flow.

Build:

- Next.js web app.
- Comparison input.
- Option entry and link paste.
- Preference question flow.
- Off-chain agent pipeline.
- Result page.
- User account.
- Saved history.
- Basic watchlist.

Do not build yet:

- Public API.
- Browser extension.
- Mobile app.
- Complex wallet auth.
- Full GenLayer consensus for every request.

Exit criteria:

- User can complete a comparison in under 2 minutes.
- Result includes top pick, top 3, trade-offs, risks, and confidence.
- At least 5 common categories work acceptably.
- App handles empty, invalid, and low-confidence inputs.

## 4. Phase 2: GenLayer Integration Beta

Goal: add GenLayer where it creates a visible product advantage.

Build:

- `GenLayerService`.
- Local/studio/testnet configuration.
- `ChoiceLensDecisionRegistry` Intelligent Contract.
- Receipt creation flow.
- Receipt status polling.
- Public receipt page.
- Admin logs for GenLayer jobs.

Exit criteria:

- Paid/test users can create a decision receipt.
- Receipt status reaches accepted and final states in test environments.
- Failed transactions do not break comparison results.
- Private data is not written on-chain.
- GenLayer cost and latency are visible in admin tools.

## 5. Phase 3: Monetization Beta

Goal: prove users can pay and receive clear premium value.

Build:

- Free/Plus/Pro limits.
- Billing checkout.
- Billing webhook.
- Subscription management.
- Usage meter.
- Receipt credits.
- Watchlist limit gates.
- Upgrade prompts.

Suggested plan structure:

- Free: limited monthly comparisons and watchlist.
- Plus: more comparisons, saved profile, watchlist alerts, receipt credits.
- Pro: bulk import, advanced weights, exports, priority jobs.

Exit criteria:

- User can subscribe, cancel, and regain access correctly.
- Usage limits cannot be bypassed easily.
- Billing state recovers from webhook delays.
- Plan limits are clear in UI.

## 6. Phase 4: Private Beta

Goal: validate retention and result quality with real users.

Beta group:

- 30 to 100 users.
- Mix of shoppers, students, workers, travelers, and app/tool buyers.

Measure:

- First comparison completion rate.
- Result satisfaction.
- Regeneration rate.
- Save/watchlist rate.
- Return rate after alert.
- Paid conversion intent.
- GenLayer receipt usage.

Exit criteria:

- At least 40 percent of beta users complete a comparison.
- At least 25 percent save or share a result.
- Users can explain what the product does without web3 language.
- GenLayer receipt value proposition is understandable to premium users.

## 7. Phase 5: Public Launch

Goal: launch a narrow but useful public version.

Launch scope:

- Web app.
- Guest compare.
- Account and saved history.
- Watchlist.
- Paid plans.
- Optional wallet receipts.
- Public result sharing.

Launch content:

- Homepage focused on the actual comparison input.
- Examples for common categories.
- Pricing page.
- Privacy policy.
- Terms.
- Help docs.
- Status page.

Exit criteria:

- Monitoring and alerting are active.
- Billing works in production.
- Wallet/GenLayer flow works on target network.
- Admin can disable GenLayer receipt creation if network issues occur.
- User support channel is ready.

The launch-readiness admin/observability surface is designed in
`docs/superpowers/specs/2026-05-20-phase3c-genlayer-ops-design.md`.

## 8. Phase 6: Production Hardening

Goal: make the product reliable enough to grow.

Workstreams:

- Performance optimization.
- Cost controls.
- Abuse prevention.
- Security review.
- Data retention and deletion.
- GenLayer contract migration process.
- Watchlist scaling.
- Prompt injection resilience.
- Accessibility.
- Internationalization.

Exit criteria:

- Defined uptime target.
- Defined incident process.
- Error budget and alert thresholds.
- Load test passes target traffic.
- Security review complete.
- Contract upgrade/migration plan tested.
- Backup and restore tested.

## 9. Production Readiness Checklist

### Product

- V1 flows are simple and fast.
- Empty and error states are polished.
- Pricing is clear.
- Watchlist alerts can be controlled by users.
- Affiliate/sponsored content is labeled.

### Engineering

- CI runs tests, type checks, linting, and build.
- Environment variables documented.
- Database migrations are repeatable.
- Queue workers are observable.
- Admin tools show job failures.
- Feature flags exist for risky integrations.

### GenLayer

- Contract code is tested.
- Contract addresses and network configs are versioned.
- Receipt payload schema is versioned.
- Transaction polling survives worker restarts.
- GenLayer failures degrade gracefully.
- Private data stays off-chain.

### Wallet

- Major wallet flows tested.
- Wrong network handling works.
- Rejected signatures/transactions are harmless.
- SIWE is nonce-protected if used.
- Wallet is optional in recommended architecture.

### Security

- Auth and authorization reviewed.
- Rate limits enabled.
- CSP configured.
- Secrets not exposed to frontend.
- Prompt injection mitigations in place.
- PII minimized and encrypted where needed.
- Billing webhook signatures verified.

### Operations

- Logs, metrics, and traces configured.
- On-call or owner notification configured.
- Backups tested.
- Rollback process documented.
- Status page or incident message path exists.

## 10. Suggested Implementation Epics

1. App foundation.
2. Comparison request flow.
3. Agent pipeline.
4. Result page.
5. User accounts and saved history.
6. Watchlist.
7. Wallet integration.
8. GenLayer receipt integration.
9. Billing and usage limits.
10. Admin and observability.
11. Security and production hardening.

## 11. Risk Register

### Risk: Product Too Broad

Mitigation:

- Start with 5 high-frequency categories.
- Keep input flexible but templates guided.
- Track category-level satisfaction.

### Risk: GenLayer Latency Hurts UX

Mitigation:

- Return off-chain draft first.
- Use GenLayer for premium receipts.
- Show async receipt status.

### Risk: Cost Overruns

Mitigation:

- Cap free usage.
- Queue and batch watchlist jobs.
- Add per-plan receipt credits.
- Track cost per comparison.

### Risk: Affiliate Bias Damages Trust

Mitigation:

- Launch without affiliate links or label them clearly.
- Keep ranking independent.
- Publish ranking policy.

### Risk: Wallet Friction

Mitigation:

- Keep wallet optional.
- Add wallet only at premium receipt moment.
- Support fiat subscription.

## 12. Decision Gate Before Coding

Before implementation begins, choose one:

- Architecture 01: recommended for consumer launch.
- Architecture 02: choose only for crypto-native launch.
- Architecture 03: choose only for API/platform-first business.

After the choice, create an implementation plan with file structure, milestones,
task order, and test plan.

