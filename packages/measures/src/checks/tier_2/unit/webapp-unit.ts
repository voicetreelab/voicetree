import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'webapp-unit',
    // tier_2: 2026-05-25 — 885-test webapp vitest suite at ~70s exceeds tier_1 individual <30s budget.
    name: 'Webapp Unit (vitest)',
    category: 'Unit',
    display: 'npm --workspace webapp exec -- vitest run',
    args: (jsonOut) => checkArgs.npmWorkspaceExec('webapp', 'vitest', 'run', ...checkArgs.vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
