# @vt/measures

`@vt/measures` is the repository's single home for codebase measurement,
health-gate tests, CI dashboard CheckDefs, metric report writers, and the
measurement runner CLIs. Health metrics live as Vitest tests under
`src/health/`; CI dashboard CheckDefs live under `src/checks/tier_N/`;
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
| CI dashboard CheckDefs | `src/checks/tier_N/<concern>/<id>.ts` |
| Runner CLIs | `src/_runners/` |
| Generated dashboard reports | `health-dashboard/reports/` |

## Schedule

**The tier folder is the source of truth.** A check's tier is its directory
location under `src/checks/`. Drop a file exporting `check: CheckDef` into
`tier_N/<anything>/<id>.ts` and it auto-runs at tier N — no registration,
no manifest, no workflow edit. The scheduler walks the path; there is no
`tier` field on `CheckDef`. Subfolders inside each tier (`lint/`, `unit/`,
`e2e/`, `static/`, `typecheck/`, `coverage/`, `structure/`, `health/`,
`contract/`, `fuzz/`, `analyzers/`) are organisational only — they do not
affect scheduling.

| Tier | Where it runs | Verb | Budget |
|---|---|---|---|
| `tier_0_pre_commit` | pre-commit hook | `npm run test:t0` | <30s |
| `tier_1` | pre-push hook (`test:local`) | `npm run test:t1` | <3min |
| `tier_2` | generated PR CI on every PR | `npm run test:t2` | <15min |
| `tier_3` | generated PR CI into `main` + nightly (`main.yml`) | `npm run test:t3` | <60min |
| `tier_4` | generated PR CI conditional into `main` + nightly drift | `npm run test:t4` | informational |
| all | release / nightly | `npm run test:full` | union of every tier |

`test:tN` walks `tier_0_pre_commit/` through `tier_N/` (via `--tier<=N` /
`--tier-max=N` / `--max-tier=N`). Higher tiers always include lower tiers.

### Tier-0 has two invocation contexts

`tier_0_pre_commit/` is discovered by `capture-ci-checks.ts` and runs on
pre-commit (and bundled into `test:t1` / `test:local`). A sibling
`tier_0_post_edit/` exists for agent hooks (`.claude/`, `.codex/`
`PostToolUse` on every Write/Edit/MultiEdit, single-file input, sub-100ms,
blocks on violation) and is NOT discovered by `capture-ci-checks.ts`.
Predicates shared between the two layers live in `src/checks/_shared/`
(pure, no I/O). Tiers 1–4 have only the scheduled context, so they keep
their bare `tier_N/` names.

## CheckDef `phase`

`CheckDef.phase?: 'parallel' | 'isolated'`. Default `'parallel'` — the
runner schedules these into a bounded pool. `'isolated'` checks execute
serially after the parallel pool drains, one at a time. Reserve `'isolated'`
for checks that need a clean CPU (Vite dev server + 5 chromium workers,
Electron startup spikes, etc.); explain the reason inline at the CheckDef.

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
