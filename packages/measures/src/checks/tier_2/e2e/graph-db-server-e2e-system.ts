import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'graph-db-server-e2e-system',
    name: 'Graph DB Server E2E System Contract',
    category: 'Integration',
    display: 'npm --workspace @vt/graph-db-server run test -- tests/e2e-system.test.ts',
    args: (jsonOut) => checkArgs.npmWorkspaceRun('@vt/graph-db-server', 'test', [...checkArgs.vitestJsonArgs(jsonOut), 'tests/e2e-system.test.ts']),
    parser: 'vitest',
}
