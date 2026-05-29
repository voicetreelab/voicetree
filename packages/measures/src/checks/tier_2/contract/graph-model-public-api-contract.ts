import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'graph-model-public-api-contract',
    name: 'Graph Model Public API Contract',
    category: 'Integration',
    display: 'npm --workspace @vt/graph-model run test -- tests/public-api-contract.test.ts',
    args: (jsonOut) => checkArgs.npmWorkspaceRun('@vt/graph-model', 'test', [...checkArgs.vitestJsonArgs(jsonOut), 'tests/public-api-contract.test.ts']),
    parser: 'vitest',
}
