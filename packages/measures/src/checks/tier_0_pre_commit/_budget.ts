// Tier 0 wall-clock budget — fast feedback checks (lint, typecheck, taxonomy).
// Discovery skips files starting with `_` (except `_all.check.ts`), so this
// file is consumed only by tier_4/timing-budget-gate.ts, not by the runner.
//
// wallClockMs — first-check-start to last-check-end across this tier.
// sumMs       — Σ durationMs across this tier; catches "parallelism hid creep"
//               when wall-clock looks fine because more cores absorbed the load.
// perCheckMaxRatio — a single check using > this fraction of wallClockMs warns
//                     in the gate output (not yet a fail; see [[future]]).

export const budget = {
    wallClockMs: 30_000,
    sumMs: 60_000,
    perCheckMaxRatio: 0.5,
} as const
