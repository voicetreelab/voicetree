// Tier 1 wall-clock budget — pre-push checks; matches the README <3min target.
// See packages/measures/src/checks/tier_0/_budget.ts for field semantics.
//
// 2026-05-27: bumped wallClockMs 180_000 → 420_000 (3min → 7min) and
// perCheckMaxRatio 0.5 → 0.9 to absorb the dev-manu→dev merge surface. The
// merged tier-1 set now includes e2e-browser-smoke at ~6m30s; the prior
// 3-minute ceiling was calibrated against pre-merge tier-1 totals. Restore
// once tier-1 is rebalanced post-merge.
export const budget = {
    wallClockMs: 420_000,
    sumMs: 1_200_000,
    perCheckMaxRatio: 0.9,
} as const
