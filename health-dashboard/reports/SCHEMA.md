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
- `status`: `pass` (exit 0), `fail` (non-zero exit or timeout), `skip` (gated off by `--quick`/`--only`).
- `durationMs`: wall-clock duration in milliseconds.
- `testsTotal/Passed/Failed/Skipped`: optional counts. Populated for vitest (`--reporter=json`) and playwright (`--reporter=json`); absent for non-test checks.
- `slow`: marks long-running checks (e.g. Stryker mutation). The runner reports `status: 'skip'` for them under `--quick`.
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
- `--quick` — skip checks marked `slow: true` (e.g. Stryker mutation).
- `--only=<checkId,...>` — run only the listed check ids. Other checks are recorded with `status: 'skip'`.
- `--fail-fast` — still records every check that ran, but stops scheduling new ones after the first failure.

Exit code is `0` when every non-slow / non-skipped check passed, `1` otherwise.
