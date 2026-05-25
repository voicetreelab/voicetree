// Tier 4 wall-clock budget — deep analyzers (mutation, dead-code, duplication).
// Currently runs in main.yml (post-merge) and nightly. Eligible for migration
// to a weekly schedule if its cost grows past this budget.
// See packages/measures/src/checks/tier_0/_budget.ts for field semantics.
//
// sumMs is intentionally null: tier_4 may grow to include long property/fuzz
// suites where a sum cap is the wrong shape. wallClockMs remains the gate.

export const budget = {
    wallClockMs: 14_400_000,
    sumMs: null,
    perCheckMaxRatio: 0.6,
} as const
