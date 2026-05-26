import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'mutation-incremental-graph-model',
    name: 'Mutation Testing — graph-model incremental (Stryker, changed files only)',
    category: 'Other',
    display: 'npm --workspace @vt/graph-model run test:mutation:incremental',
    args: () => checkArgs.npmWorkspaceRun('@vt/graph-model', 'test:mutation:incremental'),
    parser: 'none',
    timeoutMs: checkArgs.mutationIncrementalTimeoutMs,
}
