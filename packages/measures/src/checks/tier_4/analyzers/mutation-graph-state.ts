import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'mutation-graph-state',
    name: 'Mutation Testing — graph-state smoke (Stryker, break=85%)',
    category: 'Other',
    display: 'npm --workspace @vt/graph-state run test:mutation:smoke',
    args: () => checkArgs.npmWorkspaceRun('@vt/graph-state', 'test:mutation:smoke'),
    parser: 'none',
    timeoutMs: checkArgs.e2eTimeoutMs,
}
