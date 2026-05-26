# Baseline bump log

Append-only audit trail for `packages/measures/budgets/subgraph/` refreshes.
Every line below corresponds to one authorized run of
`npm run measures:capture-baselines -- --i-am-sure --reason="…"`.

Reviewers can grep `git log -- packages/measures/budgets/BASELINE_BUMP_LOG.md`
to see who refreshed what and why. If a baseline change lands without a row
appended here, that change went through the wrong path — investigate.

## Entries

- 2026-05-25T15:11:14.192Z · Manu Masson <manummasson8@gmail.com> · Disk-reconciliation feature: Pattern 1 placement of reconcileGraphWithDisk at the application/ shell (commits 8314f286, 29d57290, 5870d32e) bumps application/ by +2 implicit-globals (fs.access) and +2 boundary-width (new daemon endpoint + workflow). Also captures CSV history writer (c4192b93) which legitimately adds fs+child_process+path to _shared/writers/. Both are load-bearing shell additions; FP rearrangement does not eliminate the cost.
- 2026-05-26T02:42:38.090Z · Manu Masson <manummasson8@gmail.com> · Rebaseline after tier-split of implicit-globals (commit e85f459b, JSON commit 3199935e). The gated score now sums only strict-tier categories (fs / network / process / dynamic-import / timer / path-io); previous baselines included advisory + console, which the new code no longer counts. Every community baseline drops; none rises. Mechanical re-grounding, not a debt absorption.
- 2026-05-26 · Iris/orchestrator (full-auto authority from user prompt) via Leo · boundary-width `measures/_subgraph_gate` 92 → 93 (+1). Restoration of the missing `packages/measures/src/_subgraph_gate/index.ts` barrel that was referenced by `subgraph-gate.ts` since commit 8ea631e but never actually committed on this branch — broken state crashed `npm run health:subgraph-gate` on every `.ts` commit. The +1 is the boundary-width measurement of the restored correct state; no architectural regression. Barrel is minimal (4 named exports the runner needs: `listMeasures`, `loadBaseline`, `SubgraphMeasureResult`, `Violation`).
- 2026-05-26 · Iris/orchestrator (full-auto authority from user prompt) via Leo · boundary-width `observability/__root__` 2 → 3 (+1). Phase 4.2 of the perf-otel-grafana-stack OpenSpec adds an OTel metrics facade alongside the existing tracing facade. `packages/libraries/observability/src/metrics.ts` exports a single deep-narrow `observabilityMetrics` object (init + getMeter) — the minimum public-export channel needed to expose the new capability. Not a debt absorption; a deliberate API surface expansion authorized by the OpenSpec.
- 2026-05-26 · Iris/orchestrator (full-auto authority from user prompt) via Leo · boundary-width `observability/__root__` 3 → 4 (+1). Phase 4.3 re-exports `observabilityMetrics` from `packages/libraries/observability/src/index.ts` so consumers can import via the package's canonical barrel. The boundary-width measure counts barrel re-exports as distinct from source exports.
