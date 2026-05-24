# subgraph-scoped health baselines

Per-measure baseline files for the subgraph-scoped commit-gate
(`subgraph-scoped-health-checks` openspec change).

## Layout

```
budgets/subgraph/
  <measure-id>.json    ← one file per registered SubgraphMeasure
```

Each file:

```json
{
  "schemaVersion": 1,
  "refreshedAt": "2026-05-24T00:00:00.000Z",
  "byCommunity": {
    "graph-db-server/state": 27,
    "graph-tools/commands":   255
  }
}
```

## Refresh policy

- Written by the full-graph pre-push runner after every successful run
  (Phase 0.4 — pending wire-up).
- Never hand-edited in normal flow. A hand-edited baseline survives until
  the next pre-push run, then is silently overwritten.
- If you need to lock a baseline at a known-good value temporarily
  (e.g. while triaging a flaky measure), pin it by setting the measure's
  `baselineRefresh` to `false` in code — not by hand-editing the JSON.

## Missing-baseline policy

When a touched community has no entry in the baseline file (e.g. a brand
new directory), `loadBaseline()` returns `undefined` for that community.
Each measure's `run()` decides what that means:

- **Strict measures** treat missing baseline as `fail` (the gate must be
  authored before code lands).
- **Introductory measures** treat missing baseline as `warn` (acceptable
  for new communities that haven't been seen by the full-graph pass yet).

Default for the first month of dogfooding (per `tasks.md` Phase 3.2):
introductory / warn-only.

## Schema versioning

- Current: `schemaVersion: 1`.
- Bumping is reserved for breaking changes to the `byCommunity` value
  shape (e.g. moving from `number` to `{score, samples}` records).
- The loader rejects mismatches loudly rather than silently coercing —
  better to fail than to treat new-shape data as old.
