import {type CheckDef, E2E_TIMEOUT_MS, npmWorkspaceRun} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'mutation-graph-state',
    name: 'Mutation Testing — graph-state (Stryker, break=65%)',
    category: 'Other',
    display: 'npm --workspace @vt/graph-state run test:mutation',
    args: () => npmWorkspaceRun('@vt/graph-state', 'test:mutation'),
    parser: 'none',
    timeoutMs: E2E_TIMEOUT_MS,
}
