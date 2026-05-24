import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'graph-model-public-api-contract',
    name: 'Graph Model Public API Contract',
    category: 'Integration',
    display: 'npm --workspace @vt/graph-model run test -- tests/public-api-contract.test.ts',
    args: (jsonOut) => npmWorkspaceRun('@vt/graph-model', 'test', [...vitestJsonArgs(jsonOut), 'tests/public-api-contract.test.ts']),
    parser: 'vitest',
}
