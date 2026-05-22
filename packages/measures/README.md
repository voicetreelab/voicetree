# @vt/measures

`@vt/measures` is the repository's single home for codebase measurement,
health-gate tests, CI dashboard CheckDefs, metric report writers, and the
measurement runner CLIs. Health metrics live as Vitest tests under
`src/health/`; CI dashboard CheckDefs live under `src/checks/tier_{0..3}/`;
shared discovery, graph, complexity, purity, and writer primitives live
under `src/_shared/`.

For the full architecture, migration narrative, verifier discipline, and
follow-up queue, read:

`~/brain/mem/openspec/changes/codebase-measures-architecture/design.md`

For the tiered-schedule design (why checks live under `tier_N/` and how the
hook + CI compose them):

`~/brain/mem/openspec/changes/test-schedule-architecture/design.md`

## Source Of Truth

| Concern | Location |
|---|---|
| Package and source discovery | `src/_shared/discover-packages.ts` |
| Metric formula, budget, and report ID | `src/health/<group>/<metric>.test.ts` |
| Health report writer | `src/_shared/report-writer.ts` |
| CI dashboard CheckDefs | `src/checks/tier_{0..3}/<concern>/<id>.ts` |
| Runner CLIs | `src/_runners/` |
| Generated dashboard reports | `health-dashboard/reports/` |

## Schedule (4-tier)

A check's tier is its folder location — `src/checks/tier_N/...`. There is no
`tier` field on `CheckDef`; the scheduler reads the path. Subfolders under
each tier (`lint/`, `unit/`, `e2e/`, `static/`, `coverage/`, `structure/`,
`health/`, `contract/`, `fuzz/`, `analyzers/`) are organisational only — they
do not affect scheduling.

| Tier | Verb | Where it runs | Budget |
|---|---|---|---|
| `tier_0` | `npm run test:t0` | pre-commit | <30s — instant lint/static |
| `tier_1` | `npm run test:t1` | pre-push (via `test:local`) | <3min — unit + push-gate E2E smoke + health |
| `tier_2` | `npm run test:t2` | stage1 CI (every PR) | <15min — full unit + contract + browser E2E + fuzz |
| `tier_3` | `npm run test:t3` | merge to main + nightly | <60min — electron E2E + dead-code + duplication + mutation |
| all | `npm run test:full` | release / nightly | union of every tier |

`capture-ci-checks.ts` accepts `--tier<=N` (or `--tier-max=N` /
`--max-tier=N`) to walk only `checks/tier_0/` through `checks/tier_N/`.
Without that flag, every tier is discovered.

## CheckDef `phase`

`CheckDef.phase?: 'parallel' | 'isolated'`. Default `'parallel'` — the
runner schedules these into a bounded pool. `'isolated'` checks execute
serially after the parallel pool drains, one at a time. Reserve `'isolated'`
for checks that need a clean CPU (Vite dev server + 5 chromium workers,
Electron startup spikes, etc.); explain the reason inline at the CheckDef.

## Trigger composition

Local commands compose the CI matrix; CI workflows compose the same verbs.
There is no separate `--folder=`, `--quick`, or `slow` axis — tier folder
location IS the schedule axis.

| Trigger | Composition |
|---|---|
| `pre-commit` | `test:t0` |
| `pre-push` (`test:local`) | `test:t1` (includes tier_0) |
| `stage1-checks.yml` (PR) | `test:t2` |
| `main.yml` (merge / nightly) | `test:full` |

## Constraints

- `_shared/` is intentionally at the `codebase-directory-fanout` limit of 15
  files. Any new shared primitive should trigger a subdivision decision rather
  than another flat file.
- The whole health suite is exposed to the dashboard through one CheckDef:
  `src/checks/tier_1/health/codebase-health.ts`, which re-exports
  `src/health/_all.check.ts` (the `systems-health` aggregate). Do not look
  for, or add, per-metric CheckDefs for health tests.
- `packages/measures` measures itself. Do not exempt this package from health
  gates.
- Budget ratchets are separate work from architecture refactors. Do not change
  `MAX_*` or `MIN_*` constants just to make a structural change pass.
- A check exceeding its tier budget is re-classified up by `git mv` to the
  next tier folder, plus a 1-line inline comment + date (preserves blame).
  Never relax the tier budget to admit a slow check.
