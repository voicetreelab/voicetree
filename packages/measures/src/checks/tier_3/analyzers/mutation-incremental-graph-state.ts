import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'mutation-incremental-graph-state',
    name: 'Mutation Testing — graph-state incremental (Stryker, changed files only)',
    category: 'Other',
    display: 'npm --workspace @vt/graph-state run test:mutation:incremental',
    args: () => checkArgs.npmWorkspaceRun('@vt/graph-state', 'test:mutation:incremental'),
    parser: 'none',
    timeoutMs: checkArgs.mutationIncrementalTimeoutMs,
}
