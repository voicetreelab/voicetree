import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'graph-state-public-api-contract',
    name: 'Graph State Public API Contract',
    category: 'Integration',
    display: 'npm --workspace @vt/graph-state run test -- tests/public-api-contract.test.ts',
    args: (jsonOut) => npmWorkspaceRun('@vt/graph-state', 'test', [...vitestJsonArgs(jsonOut), 'tests/public-api-contract.test.ts']),
    parser: 'vitest',
}
