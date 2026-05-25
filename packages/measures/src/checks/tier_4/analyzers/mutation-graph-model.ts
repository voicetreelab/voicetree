import {type CheckDef, E2E_TIMEOUT_MS, npmWorkspaceRun} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'mutation-graph-model',
    name: 'Mutation Testing — graph-model (Stryker, break=70%)',
    category: 'Other',
    display: 'npm --workspace @vt/graph-model run test:mutation',
    args: () => npmWorkspaceRun('@vt/graph-model', 'test:mutation'),
    parser: 'none',
    timeoutMs: E2E_TIMEOUT_MS,
}
