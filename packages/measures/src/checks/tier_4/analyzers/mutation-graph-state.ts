import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'mutation-graph-state',
    name: 'Mutation Testing — graph-state (Stryker, break=65%)',
    category: 'Other',
    display: 'npm --workspace @vt/graph-state run test:mutation',
    args: () => checkArgs.npmWorkspaceRun('@vt/graph-state', 'test:mutation'),
    parser: 'none',
    timeoutMs: checkArgs.e2eTimeoutMs,
}
