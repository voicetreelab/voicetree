# scripts/measures/

Single source of truth for the CI/CD checks shown on the codebase health dashboard.

Every `.ts` file under `src/` (except `_*.ts`) defines one check. The capture
runner (`scripts/capture-ci-checks.mjs`) recursively discovers this tree,
dynamically imports each file, and expects a `check: CheckDef` export. Adding a
check = drop a file.

`npm run health` also runs every check under `scripts/measures/src/health/tier_1/` through
`npm run health:tier1`. Keep that folder for enforced push-tier checks.

Current groups:

```text
src/
|-- correctness/
|   |-- unit/
|   |-- e2e/
|   |-- lint/
|   `-- slow/
|       `-- fuzz/
`-- health/
    |-- tier_1/
    |-- fast/
    `-- slow/
```

## Add a new check

Create `scripts/measures/src/<group>/<speed-or-kind>/<id>.ts`:

```ts
import {type CheckDef, npmRun} from '../../_types.ts'

export const check: CheckDef = {
    id: 'my-new-check',           // kebab-case, must match the filename
    name: 'My New Check',         // human label shown on the dashboard
    category: 'Static',           // Unit | Integration | E2E | Lint | TypeCheck | Static | Other
    display: 'npm run my:check',  // what the dashboard shows under the name
    args: () => npmRun('my:check'),
    parser: 'none',               // 'vitest' | 'playwright' | 'none'
}
```

Use `../../_types.ts` from the standard two-level group folders.

Then:

```bash
npm run health:capture-ci -- --only=my-new-check    # smoke-test just this one
npm run health:capture-ci -- --folder=health/tier_1 # run an enforced tier folder
npm run health:tier1                                # same health/tier_1 checks used by npm run health
npm run health:capture-ci                           # full run, writes reports
npm run health:dashboard                            # see it on the dashboard
```

## Helpers (in `_types.ts`)

| Helper | Use |
|---|---|
| `npmRun(name, extras?)` | `npm run <name>` (root) |
| `npmWorkspaceRun(ws, name, extras?)` | `npm --workspace <ws> run <name>` |
| `npmWorkspaceExec(ws, ...args)` | `npm --workspace <ws> exec -- ...` |
| `vitestJsonArgs(jsonOut)` | Append for vitest checks so counts are parsed |
| `playwrightJsonArgs()` | Append for playwright checks so counts are parsed |
| `E2E_TIMEOUT_MS` | 30 min — use as `timeoutMs` for slow suites |

## Parsers

- `parser: 'vitest'` — runner passes `--reporter=json --outputFile=<tmp>`; you must include `vitestJsonArgs(jsonOut)` in your `args`. Test pass/fail/skip counts populate the dashboard.
- `parser: 'playwright'` — runner sets `PLAYWRIGHT_JSON_OUTPUT_FILE` in env; you must include `playwrightJsonArgs()` in `args`. Stats parsed from `json.stats`.
- `parser: 'none'` — pass/fail comes from process exit code only. No counts.

## Optional fields

- `slow: true` — skipped under `--quick`.
- `timeoutMs: number` — default 10min, bump for E2E.

## Where output lands

- Per-check JSON: `health-dashboard/reports/checks/<id>.json`
- Aggregate: `health-dashboard/reports/checks.json` (consumed by `health-dashboard/app.js`)

## Related

- Runner: `scripts/capture-ci-checks.mjs`
- Writer / schema: `packages/systems/_ci-check-writer.ts`
- Dashboard renderer: `health-dashboard/checks.js`
- Complexity test reports (different surface — self-registering vitest tests): `packages/systems/*.test.ts`
