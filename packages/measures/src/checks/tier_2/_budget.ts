// Tier 2 wall-clock budget — integration, browser smoke, deterministic fuzz.
// See packages/measures/src/checks/tier_0/_budget.ts for field semantics.

export const budget = {
    wallClockMs: 300_000,
    sumMs: 1_800_000,
    perCheckMaxRatio: 0.4,
} as const
