import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'mutation-graph-model',
    name: 'Mutation Testing — graph-model smoke (Stryker, break=70%)',
    category: 'Other',
    display: 'npm --workspace @vt/graph-model run test:mutation:smoke',
    args: () => checkArgs.npmWorkspaceRun('@vt/graph-model', 'test:mutation:smoke'),
    parser: 'none',
    timeoutMs: checkArgs.e2eTimeoutMs,
}
