// Tier 2 wall-clock budget — PR CI checks; matches the README <15min target.
// See packages/measures/src/checks/tier_0/_budget.ts for field semantics.

export const budget = {
    wallClockMs: 900_000,
    sumMs: 1_800_000,
    perCheckMaxRatio: 0.4,
} as const
