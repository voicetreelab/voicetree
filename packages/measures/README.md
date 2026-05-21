# `@vt/measures` — Architecture Reference

## What this package is

`@vt/measures` is THE one home for codebase-measurement infrastructure in this repository. It owns: discovery of packages and production source files (via `_shared/discover-packages.ts`); metric computation expressed as vitest tests under `src/health/`; CheckDef registrations for the CI dashboard under `src/correctness/` and `src/external/`; runner CLIs under `src/_runners/`; and all shared report writers and measurement primitives under `src/_shared/`. Every metric gate, every dashboard tile, and every measurement pipeline script lives here and nowhere else.

This package replaces the former `packages/codebase-health/` (29 vitest tests + 7 primitive modules), `scripts/measures/` (CheckDef stubs + invariant data), the standalone `scripts/check-*.mjs` scripts (`check-complexity-health.mjs`, `check-coupling.mjs`, `check-circular-deps.mjs`), the `scripts/measure-*.mjs` scripts (`measure-relative-imports.mjs`, `measure-relative-paths.mjs`), five runner scripts (`scripts/capture-ci-checks.mjs`, `scripts/run-test-parallel.mjs`, `scripts/run-with-xvfb-if-needed.mjs`, `scripts/record-run.mjs`, `scripts/record-result.mjs`), two lint helpers (`scripts/verify-cytoscape-lint-rules.mjs`, `scripts/lint-blackbox-tests.sh`), and the legacy `packages/libraries/ci-reporting/` workspace package (absorbed into `src/_shared/` in Phase 11 Path B).

---

## Filesystem tree

```
packages/measures/
├── package.json                         ← name: "@vt/measures"
├── README.md                            ← this file
└── src/
    ├── _types.ts                        ← CheckDef type + npmRun helper
    ├── _shared/                         ← Measurement primitives (15 files — at fanout limit)
    │   ├── discover-packages.ts         ← ONE discovery walker, used by every test
    │   ├── report-writer.ts             ← calls recordHealthReport
    │   ├── call-graph.ts
    │   ├── import-graph.ts
    │   ├── purity-analysis.ts
    │   ├── cogcx-scorer.ts
    │   ├── hierarchical-complexity-measures.ts
    │   ├── cyclomatic.ts
    │   ├── maintainability.ts
    │   ├── runtime-fan-in.ts
    │   ├── function-discovery.ts
    │   ├── function-row-formatters.ts
    │   ├── check-report-writer.ts       ← (absorbed from @vt/ci-reporting in Phase 11 Path B)
    │   ├── health-report-writer.ts      ← (absorbed from @vt/ci-reporting in Phase 11 Path B)
    │   └── vitest-ci-check-reporter.ts  ← (absorbed from @vt/ci-reporting in Phase 11 Path B)
    ├── _runners/                        ← CLI entry points (invoked via node --experimental-strip-types)
    │   ├── capture-ci-checks.ts
    │   ├── run-test-parallel.ts
    │   ├── run-with-xvfb-if-needed.ts
    │   ├── record-run.ts
    │   └── record-result.ts
    ├── health/                          ← Code-quality metrics (vitest .test.ts files)
    │   ├── _all.check.ts                ← ONE CheckDef wrapping the entire vitest suite
    │   ├── complexity/                  ← (9 files)
    │   │   ├── behavioral-complexity.test.ts
    │   │   ├── cognitive-complexity.test.ts
    │   │   ├── crap0.test.ts
    │   │   ├── cyclomatic-complexity.test.ts
    │   │   ├── hierarchical-complexity.test.ts
    │   │   ├── maintainability-index.test.ts
    │   │   ├── runtime-fan-in.test.ts
    │   │   ├── shape-complexity.test.ts
    │   │   └── transitive-complexity-graph.test.ts
    │   ├── coupling/                    ← (12 files; absorbs check-coupling.mjs + check-circular-deps.mjs)
    │   │   ├── boundary-complexity.test.ts
    │   │   ├── cross-package-coupling.test.ts
    │   │   ├── cross-package-cycles.test.ts
    │   │   ├── dsm-compression.test.ts
    │   │   ├── dsm-matrix.test.ts
    │   │   ├── hypergraph-complexity.test.ts
    │   │   ├── modularity-q.test.ts
    │   │   ├── package-boundaries.test.ts
    │   │   ├── relative-import-depth.test.ts
    │   │   ├── semantic-coupling-graph.test.ts
    │   │   ├── system-package-coupling.test.ts
    │   │   └── treewidth-coupling.test.ts
    │   ├── shape/                       ← (6 files)
    │   │   ├── codebase-shape.test.ts
    │   │   ├── exports-per-file.test.ts
    │   │   ├── graph-entropy.test.ts
    │   │   ├── import-graph-invariants.test.ts
    │   │   ├── martin-metrics.test.ts
    │   │   └── relative-path-depth.test.ts
    │   ├── purity/                      ← (4 files)
    │   │   ├── function-health.test.ts
    │   │   ├── purity-ratio-ast.test.ts
    │   │   ├── purity-ratio.test.ts
    │   │   └── transitive-purity-graph.test.ts
    │   ├── churn/                       ← (2 files)
    │   │   ├── change-coupling.test.ts
    │   │   └── turbulence.test.ts
    │   ├── pressure/                    ← (1 file: consolidates 10 complexity-pressure axes)
    │   │   └── pressure-axes.test.ts
    │   └── meta/                        ← (4 files)
    │       ├── ci-coverage.test.ts
    │       ├── default-value-detection.test.ts
    │       ├── gate-integrity.test.ts
    │       └── script-tamper-guard.test.ts
    ├── correctness/                     ← Unit/e2e/lint/fuzz dashboard CheckDefs
    │   ├── unit/
    │   ├── e2e/
    │   ├── lint/
    │   │   ├── blackbox-tests.test.ts       (was scripts/lint-blackbox-tests.sh)
    │   │   └── verify-cytoscape-lint-rules.test.ts  (was scripts/verify-cytoscape-lint-rules.mjs)
    │   └── slow/fuzz/
    └── external/                        ← Non-vitest dashboard CheckDefs
        ├── tier_1/
        │   ├── ci-coverage.ts
        │   ├── codebase-health.ts
        │   ├── orange-gate.ts
        │   ├── graph-db-server-e2e-system.ts
        │   ├── graph-db-client-e2e-system.ts
        │   ├── graph-tools-e2e-system.ts
        │   ├── graph-model-public-api-contract.ts
        │   ├── graph-state-public-api-contract.ts
        │   ├── relative-import-depth.ts
        │   └── relative-path-depth.ts
        ├── fast/
        │   └── e2e-taxonomy.ts
        └── slow/
            ├── dead-code.ts
            ├── duplication.ts
            └── mutation.ts
```

Subfolders cap at 15 entries per `codebase-directory-fanout` gate. `_shared/` is currently at the limit; future additions require subdivision (e.g., `_shared/writers/`, `_shared/graph-primitives/`) — see `~/brain/mem/openspec/changes/codebase-measures-architecture/design.md` § "_shared/ at fanout=15".

---

## Sources of truth

| Concern | Source of truth | Notes |
|---|---|---|
| **Package discovery** | `src/_shared/discover-packages.ts` | One walker. Deny-list is the only place to add/remove exclusions. |
| **Metric formula + budget + ratchet** | `src/health/<group>/<metric>.test.ts` | One file = one metric = one JSON. Pre-push enforced. |
| **Report JSON snapshots** | `health-dashboard/reports/<metric-id>.json` | Written by exactly one test. Read-only for everyone else. |
| **Dashboard CheckDef (non-vitest checks)** | `src/external/<tier>/<id>.ts` | Auto-discovered. Data, not computation. |
| **Dashboard CheckDef (unit/e2e/lint suites)** | `src/correctness/<kind>/<id>.ts` | Same CheckDef shape; lives under correctness/ by content kind. |
| **Metric primitives** | `src/_shared/{call-graph,import-graph,purity-analysis,cogcx-scorer,hierarchical-complexity-measures,cyclomatic,maintainability,runtime-fan-in,function-discovery,function-row-formatters}.ts` | Pure-function exports; imported by health/ tests. |
| **Report writers** | `src/_shared/{check-report-writer,health-report-writer}.ts` | Absorbed from `@vt/ci-reporting` in Phase 11 Path B. |
| **Vitest CI reporter** | `src/_shared/vitest-ci-check-reporter.ts` | Absorbed from `@vt/ci-reporting` in Phase 11 Path B. |
| **Measurement runner code** | `src/_runners/` | capture-ci-checks, run-test-parallel, record-run, record-result, run-with-xvfb-if-needed. |
| **Package exports** | `package.json` | Exposes `./vitest-reporter` and `./check-report-writer` for in-repo consumers. |
| **Architecture discipline (the rules)** | `packages/measures/README.md` | This file. Lives in code, not in docs/. |

---

## Seven discipline rules

### 1. One metric ⇒ one test file ⇒ one report JSON
No metric is computed twice. No JSON is written by two paths.

Before this package existed, `function-maintainability-index` (vitest, whole-repo scope) and `complexity-pressure-maintainability-min` (script, `packages/systems/` only) used the identical Halstead formula but produced divergent reports. The dashboard had no single source of truth. One-test-one-metric eliminates that: there is exactly one file that owns each report ID, and refactoring or ratcheting that metric is a single-file edit with no coordination overhead.

### 2. Discovery is shared
Every walk goes through `_shared/discover-packages.ts`. Deny-list is the only place to exclude.

Multiple discovery walkers were the original drift source. `scripts/check-coupling.mjs`, `scripts/check-circular-deps.mjs`, and `packages/codebase-health/src/discover-packages.ts` each implemented independent traversal with different hard-coded exclusion sets. One walker means one deny-list, one source of `PackageInfo[]`, and one canonical answer to "which packages do we scan?" The current deny-list contains three entries: `brain`, `vt-website-quartz`, `voicetree-evals`.

### 3. Self-inclusion
`packages/measures` is NOT exempt from its own metrics. If a metric flags measures, fix measures.

The former `packages/codebase-health` excluded itself from discovery (`EXCLUDED_RELATIVE_PATHS` contained `'packages/codebase-health'`). The practical consequence: `packages/codebase-health/src/` had 36 immediate children — more than double its own `MAX_DIRECTORY_CHILDREN = 15` fanout gate — with zero enforcement. Self-exclusion means the metric system silently exempts its own worst offender. `packages/measures/` is not on the deny-list and passes its own gates by construction.

### 4. CheckDefs are declarative
A CheckDef is data (`id`, `name`, `category`, `parser`, `args`). It never contains computation. Adding a metric never requires touching `external/` or `correctness/` unless you're changing the dashboard label, tier, or parser.

The health/ suite is wrapped by ONE CheckDef (`health/_all.check.ts`) — per-metric dashboard tiles come from the JSON reports the tests write, not from per-metric CheckDefs. Previously, each migrated check script had a corresponding CheckDef stub; deleting those stubs eliminated a class of drift where a stale stub referenced a deleted script.

### 5. No parallel implementations
All metric computation lives in `packages/measures/src/health/`. No `scripts/check-*.mjs` family. No duplicate report IDs.

Two parallel implementations of the same metric (e.g. duplicated MI computation under different IDs) produce dashboard readings that cannot be reconciled — "which one is the truth?" is unanswerable. The rule is enforced by the fact that `scripts/check-*.mjs` no longer exists; any future attempt to add one should be treated as a defect, not a convenience.

### 6. Subfolders ≤15 children, by concern
The fanout gate applies to measures itself.

Phase 11 Path B consolidated `_shared/` to exactly 15 files — the `codebase-directory-fanout` gate limit. The rule is enforced by `codebase-directory-fanout.json` not as policy but as code: the test will fail if any subfolder exceeds 15 immediate children, including `packages/measures/src/` itself. When the next `_shared/` addition is proposed, the fanout pressure should trigger either subdivision (candidate groups: `writers/`, `graph-primitives/`, `complexity-primitives/`, `discovery/`) or a reconsideration of whether the addition belongs in `_shared/` at all.

### 7. No gate ratchets bundled with architecture refactors
This change preserves all `MAX_*` / `MIN_*` constants exactly. Ratchets are separate PRs.

Bundling a budget change with a file-reorganization commit makes it impossible to bisect whether a regression came from the structural change or the budget relaxation. The 13-phase migration executed with zero budget changes: every verifier gate compared normalized JSON output against a standardized-environment baseline, and any divergence from the expected structural deltas failed the phase. Future ratchets land as one-file edits on a clean foundation.

---

## How to add a new metric

1. **Pick a concern folder.** Choose the closest match under `src/health/`: `complexity/`, `coupling/`, `shape/`, `purity/`, `churn/`, `pressure/`, or `meta/`. If the metric doesn't fit any existing concern, create a new subfolder (subject to the ≤15 children rule on `health/` itself).

2. **Create `<metric>.test.ts` in that subfolder.** Name the file after the report ID that the test will write (e.g. `src/health/coupling/relative-import-depth.test.ts` writes `relative-import-depth.json`). See existing files like `src/health/shape/exports-per-file.test.ts` for the pattern.

3. **Use `_shared/discover-packages.ts` for the file walk.** Import `discoverPackages()` — do not write a new walker or hard-code paths. The deny-list in `discover-packages.ts` is the only exclusion mechanism.

4. **Compute using existing primitives.** Check `src/_shared/` first: `import-graph.ts`, `purity-analysis.ts`, `cogcx-scorer.ts`, `cyclomatic.ts`, `maintainability.ts`, `hierarchical-complexity-measures.ts`, `call-graph.ts`, `runtime-fan-in.ts`, `function-discovery.ts`, `function-row-formatters.ts`. Add a primitive to `_shared/` only if the formula is genuinely reusable across multiple metrics.

5. **Write the report via `_shared/report-writer.ts`.** Call `recordHealthReport(id, data)` — this writes `health-dashboard/reports/<id>.json`. Do not write to any other path.

6. **The dashboard picks it up automatically.** `health/_all.check.ts` wraps the entire vitest suite as a single CheckDef; your new test is included in the next `npm run measures` run. No changes needed in `external/` or `correctness/` unless you want a separate per-metric dashboard tile with a custom label or tier.

7. **Verify.** Run `npx vitest run packages/measures/src/health/<concern>/<metric>.test.ts` directly, or `npm run test:measures` to run the full suite. Confirm `health-dashboard/reports/<id>.json` is written and the JSON structure matches your intent.

---

## How to add a new dashboard CheckDef

1. **Decide if the check is vitest-runnable or external-process.** Vitest-runnable checks (unit tests, e2e suites, lint passes) belong under `src/correctness/<kind>/`. Non-vitest checks (knip, jscpd, stryker, playwright, custom scripts) belong under `src/external/<tier>/`.

2. **Create the `.ts` file** with the `CheckDef` shape from `src/_types.ts`: `{ id, name, category, parser, args, display, slow?: boolean }`. The file must `export const check: CheckDef = { … }`. See `src/external/slow/duplication.ts` or `src/external/tier_1/ci-coverage.ts` as templates.

3. **If the check runs an npm script**, add `"<id>": "node --experimental-strip-types …"` in root `package.json`. The `args` field in your CheckDef should reference that script name via `npmRun("<id>")`.

4. **No registry edit required.** `src/_runners/capture-ci-checks.ts` walks `src/{health,correctness,external}/` and discovers any file that exports `check: CheckDef`. Dropping the file in the right folder is sufficient.

5. **For vitest-wrapping CheckDefs** (e.g., a suite in another package), set `parser: 'vitest'` and point `args` at the package or vitest config. See `src/correctness/unit/graph-model-unit.ts` for a representative example.

---

## How runners work

The five runners in `src/_runners/` form the measurement pipeline. They are invoked from root `package.json` scripts via `node --experimental-strip-types packages/measures/src/_runners/<name>.ts`.

- **`capture-ci-checks.ts`** — the registry walker. Discovers all CheckDef exports under `src/{health,correctness,external}/`, executes each check command, captures pass/fail + timing, and writes the aggregate to `health-dashboard/reports/checks.json`. Usage: `npm run measures:capture-ci [-- --quick] [--folder=<sub>] [--only=<ids>]`.

- **`record-run.ts`** — umbrella check wrapper. Wraps an `npm run X` invocation with timing and result capture, writing a dashboard report to `health-dashboard/reports/checks/<id>.json`. Used by top-level scripts like `npm run measures`, `npm run check`, `npm run lint`.

- **`record-result.ts`** — companion to `record-run.ts`. Structured result writer for one-off results, used when a caller already has the outcome and just needs it persisted to the dashboard.

- **`run-test-parallel.ts`** — today's hand-coded Phase-1/Phase-2 parallel topology for the `npm run test` orchestration. Note: per the `test-schedule-architecture` follow-up epic (see §Related work), this runner is slated for removal — its topology will become declarative `phase: 'parallel' | 'isolated'` fields on CheckDefs.

- **`run-with-xvfb-if-needed.ts`** — cross-platform Xvfb shim. Detects headless Linux environments and wraps commands that require a display (playwright, Electron) with `xvfb-run`. No-op on macOS.

---

## Related work and follow-ups

The following work depends on or extends this epic:

- **`min-maintainability-index` gate flip** (`task_17793530455183xu`). Deferred until this epic lands. Once `pressure-axes.test.ts` lives in vitest, the MI flip is a one-file edit to a single `MIN_*` constant with no architectural decisions required.

- **`test-schedule-architecture` openspec** (`~/brain/mem/openspec/changes/test-schedule-architecture/`). Adds the SCHEDULE layer on top of this package: 4 cost-tier folders (`checks/tier_{0,1,2,3}/<concern>/`), `--tier<=N` inclusive-ceiling composition semantics on `capture-ci-checks`, a declarative `phase?: 'parallel' | 'isolated'` field on `CheckDef` (absorbing `run-test-parallel.ts` topology), and a collapse of `.githooks/pre-push.impl.sh` to `exec npm run test`. The `correctness/` and `external/` folder conventions are intentionally preserved as-is in this epic; the test-schedule-architecture change restructures them into `checks/tier_N/`.

- **Writer dedup** (`src/_shared/{check-report-writer,health-report-writer}.ts`). The two writers share near-duplicate `writeJsonAtomic` + readAll patterns. A shared atomic-write helper would tighten the surface. Queued in `design.md` tech-debt list.

- **`purity-analysis.ts:296` source-side sort**. `Promise.all` completion-order produces ordering drift in approximately 11 reports. A stable sort before returning would make purity-derived reports byte-stable and allow the corresponding NORMALIZE rules to become defensive no-ops. Queued in `design.md` tech-debt list.

- **`isProductionSource` predicate centralization**. Approximately 15 duplicated call sites across `src/health/*.test.ts`. Defense-in-depth additions to one site do not propagate. Centralizing into a single export under `src/_shared/` is a deep-and-narrow refactor. Queued in `design.md` tech-debt list.
