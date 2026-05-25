// Tier 3 wall-clock budget — heavier E2E (currently Electron tier-2 only).
// See packages/measures/src/checks/tier_0/_budget.ts for field semantics.

export const budget = {
    wallClockMs: 1_800_000,
    sumMs: 7_200_000,
    perCheckMaxRatio: 0.6,
} as const
