// Tier 1 wall-clock budget — most unit tests + fast static analyzers.
// See packages/measures/src/checks/tier_0/_budget.ts for field semantics.

export const budget = {
    wallClockMs: 120_000,
    sumMs: 600_000,
    perCheckMaxRatio: 0.5,
} as const
