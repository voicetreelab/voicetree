# @vt/measures

`@vt/measures` is the repository's single home for codebase measurement,
health-gate tests, CI dashboard CheckDefs, metric report writers, and the
measurement runner CLIs. Health metrics live as Vitest tests under
`src/health/`; CI dashboard definitions live under `src/correctness/` and
`src/external/`; shared discovery, graph, complexity, purity, and writer
primitives live under `src/_shared/`.

For the full architecture, migration narrative, verifier discipline, and
follow-up queue, read:

`~/brain/mem/openspec/changes/codebase-measures-architecture/design.md`

## Source Of Truth

| Concern | Location |
|---|---|
| Package and source discovery | `src/_shared/discover-packages.ts` |
| Metric formula, budget, and report ID | `src/health/<group>/<metric>.test.ts` |
| Health report writer | `src/_shared/report-writer.ts` |
| CI dashboard CheckDefs | `src/correctness/` and `src/external/` |
| Runner CLIs | `src/_runners/` |
| Generated dashboard reports | `health-dashboard/reports/` |

## Constraints

- `_shared/` is intentionally at the `codebase-directory-fanout` limit of 15
  files. Any new shared primitive should trigger a subdivision decision rather
  than another flat file.
- The whole health suite is exposed to the dashboard through one CheckDef:
  `src/health/_all.check.ts`, the `systems-health` aggregate. Do not look for,
  or add, per-metric CheckDefs for health tests.
- `packages/measures` measures itself. Do not exempt this package from health
  gates.
- Budget ratchets are separate work from architecture refactors. Do not change
  `MAX_*` or `MIN_*` constants just to make a structural change pass.
