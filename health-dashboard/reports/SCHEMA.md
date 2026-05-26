# Health Dashboard Report Schema

Health tests write their last observed state to `health-dashboard/reports/`. The dashboard reads this directory instead of running tests on page load.

Each metric writes one file named `<metricId>.json`. The aggregate file `latest.json` contains all metric reports sorted by category, metric name, and metric id.

## Metric Report

```ts
type HealthReport = {
  metricId: string
  metricName: string
  description: string
  category: 'Coupling' | 'Complexity' | 'Purity' | 'Behavioral' | 'Shape' | 'Churn' | 'Structure' | 'Other'
  current: number
  budget: number
  comparison: 'lte' | 'gte'
  passed: boolean
  unit?: string
  timestamp: string
  details?: Record<string, unknown>
}
```

## Fields

- `metricId`: unique kebab-case id. This becomes the per-metric JSON filename.
- `metricName`: human-readable display name.
- `description`: one-line explanation of what the metric measures.
- `category`: dashboard grouping.
- `current`: last observed numeric value.
- `budget`: threshold used by the corresponding test.
- `comparison`: `lte` passes when `current <= budget`; `gte` passes when `current >= budget`.
- `passed`: must match the comparison result.
- `unit`: optional display suffix such as `%`, `edges`, `bits`, or `ratio`.
- `timestamp`: ISO timestamp for when the metric was recorded.
- `details`: optional JSON payload for charts, tables, and metric-specific diagnostics.

## Per-Metric Example

```json
{
  "metricId": "dsm-compression",
  "metricName": "DSM Compression Ratio",
  "description": "Compressibility of the systems package dependency matrix.",
  "category": "Structure",
  "current": 0.7312,
  "budget": 0.8873,
  "comparison": "lte",
  "passed": true,
  "unit": "ratio",
  "timestamp": "2026-05-13T02:30:00.000Z",
  "details": {
    "originalSize": 3021,
    "compressedSize": 2209
  }
}
```

## Aggregate Example

```json
{
  "generatedAt": "2026-05-13T02:30:01.000Z",
  "reports": [
    {
      "metricId": "dsm-compression",
      "metricName": "DSM Compression Ratio",
      "description": "Compressibility of the systems package dependency matrix.",
      "category": "Structure",
      "current": 0.7312,
      "budget": 0.8873,
      "comparison": "lte",
      "passed": true,
      "unit": "ratio",
      "timestamp": "2026-05-13T02:30:00.000Z"
    }
  ]
}
```

## CI/CD Check Report

CI/CD checks (unit, integration, e2e, lint, typecheck, static analysis) are captured separately by `npm run measures:capture-ci`. Each check writes one file named `checks/<checkId>.json`. The aggregate file `checks.json` contains every check report sorted by category, name, and id.

```ts
type CheckReport = {
  checkId: string
  checkName: string
  category: 'Unit' | 'Integration' | 'E2E' | 'Lint' | 'TypeCheck' | 'Static' | 'Command' | 'Hook' | 'Other'
  command: string
  status: 'pass' | 'fail' | 'skip'
  durationMs: number
  testsTotal?: number
  testsPassed?: number
  testsFailed?: number
  testsSkipped?: number
  slow?: boolean
  errorSummary?: string
  timestamp: string
  details?: Record<string, unknown>
}
```

### Fields

- `checkId`: unique kebab-case id. Becomes the per-check JSON filename under `checks/`.
- `checkName`: human-readable display name.
- `category`: dashboard grouping. `TypeCheck` covers `tsc --noEmit`; `Static` covers knip, jscpd, custom analyzers; `Command` covers umbrella npm scripts (e.g. `npm run test`); `Hook` covers git hooks and Claude Code hooks.
- `command`: exact shell command invoked, for the dashboard's monospace subtitle.
- `status`: `pass` (exit 0), `fail` (non-zero exit or timeout), `skip` (gated off by `--only`).
- `durationMs`: wall-clock duration in milliseconds.
- `testsTotal/Passed/Failed/Skipped`: optional counts. Populated for vitest (`--reporter=json`) and playwright (`--reporter=json`); absent for non-test checks.
- `slow`: marks long-running reports written by explicit wrappers such as `record-run --slow`.
- `errorSummary`: truncated stderr (≤4 lines) when the check failed. No full traces.
- `timestamp`: ISO timestamp for when the check finished.
- `details`: optional JSON payload for runner-specific diagnostics (e.g. exitCode, configPath).

### Per-Check Example

```json
{
  "checkId": "root-lint",
  "checkName": "Root ESLint",
  "category": "Lint",
  "command": "npm run lint",
  "status": "pass",
  "durationMs": 4321,
  "timestamp": "2026-05-13T02:30:00.000Z",
  "details": { "exitCode": 0 }
}
```

### Aggregate Example

```json
{
  "generatedAt": "2026-05-13T02:30:01.000Z",
  "reports": [
    {
      "checkId": "root-lint",
      "checkName": "Root ESLint",
      "category": "Lint",
      "command": "npm run lint",
      "status": "pass",
      "durationMs": 4321,
      "timestamp": "2026-05-13T02:30:00.000Z"
    }
  ]
}
```

### Runner

`npm run measures:capture-ci` runs each check via `child_process.spawn`, parses test counts where possible, and writes the reports through `recordCheckReport()`.

Flags:
- `--only=<checkId,...>` — run only the listed check ids. Other checks are recorded with `status: 'skip'`.
- `--tier<=N` / `--tier-max=N` / `--max-tier=N` — run checks under `checks/tier_0_pre_commit` through `checks/tier_N` (and any legacy bare `tier_K/` folders).
- `--fail-fast` — still records every check that ran, but stops scheduling new ones after the first failure.

Exit code is `0` when every non-skipped check passed, `1` otherwise.

## Scores History

Every `recordHealthReport` and `recordCheckReport` also appends a single row to a scores-history CSV so a regression can be blamed to the commit that introduced it.

### Files

| File | Tracked? | Written when |
|------|----------|--------------|
| `scores-history.csv` | yes (`.gitattributes merge=union`) | working tree is clean at process start |
| `scores-history.local.csv` | no (`.gitignore`) | working tree is dirty at process start |

The clean-tree gate is what makes the tracked CSV trustworthy: a row's `commit` field reflects the exact source tree that produced the score. Dirty-tree rows route to the local sibling so they never contaminate the shared history with mislabelled scores. The cleanliness check (`git status --porcelain`) and the SHA (`git rev-parse --short HEAD`) are resolved once per process.

`merge=union` keeps both branches' rows on rebase/cherry-pick. Rows are row-independent so this stays safe.

### Schema

```
commit,measure,score,status
29d57290,hypergraph-bci,50.60,pass
29d57290,check/root-lint,2642,pass
c4192b93,check/blackbox-tests-lint,1332,fail
```

| Column | Type | Notes |
|--------|------|-------|
| `commit` | string | `git rev-parse --short HEAD`, or `working-tree` if git is unavailable. |
| `measure` | string | Metric id, or `check/<checkId>` for CheckReport rows. |
| `score` | number | `current` for health metrics; `durationMs` for checks. Floats keep full precision. |
| `status` | `pass` \| `fail` \| `''` | Health: `passed ? 'pass' : 'fail'`. Checks: `report.status` (skips emit no row). Empty when status is not meaningful. |

### Limitations

- Subgraph-gate per-community baselines (`packages/measures/budgets/subgraph/*.json`) are not captured here; they live on a different write path and already have native git-blame.
- Skip rows emit no entry. Status is captured at write time; per-check `details` and `errorSummary` stay in the per-check JSON.
