import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'graph-state-public-api-contract',
    name: 'Graph State Public API Contract',
    category: 'Integration',
    display: 'npm --workspace @vt/graph-state run test -- tests/invariants/public-api-contract.test.ts',
    args: (jsonOut) => checkArgs.npmWorkspaceRun('@vt/graph-state', 'test', [...checkArgs.vitestJsonArgs(jsonOut), 'tests/invariants/public-api-contract.test.ts']),
    parser: 'vitest',
}
