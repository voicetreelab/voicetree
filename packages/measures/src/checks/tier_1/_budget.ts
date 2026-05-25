// Tier 1 wall-clock budget — pre-push checks; matches the README <3min target.
// See packages/measures/src/checks/tier_0/_budget.ts for field semantics.

export const budget = {
    wallClockMs: 180_000,
    sumMs: 600_000,
    perCheckMaxRatio: 0.5,
} as const
