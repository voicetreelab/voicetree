import {type CheckDef} from '../../_types.ts'

// Tier wall-clock budget gate.
//
// Marked phase: 'isolated' so the runner schedules it after every parallel and
// exclusive check completes. By then each tier's per-check reports are on disk
// (recordOutcome now fires per-check in capture-ci-checks.ts), and the gate
// computes wall-clock = max(endedAt) - min(startedAt) per tier and compares
// against tier_N/_budget.ts.

export const check: CheckDef = {
    id: 'tier-time-budget-gate',
    name: 'Tier wall-clock budget gate',
    category: 'Static',
    display: 'tier-time-budget-gate',
    args: () => [
        'node',
        '--no-warnings=ExperimentalWarning',
        '--experimental-strip-types',
        'packages/measures/scripts/check-tier-budgets.ts',
    ],
    parser: 'none',
    phase: 'isolated',
}
