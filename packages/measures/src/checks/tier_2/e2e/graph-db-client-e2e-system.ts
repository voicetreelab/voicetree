import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'graph-db-client-e2e-system',
    name: 'Graph DB Client E2E System Contract',
    category: 'Integration',
    display: 'npm --workspace @vt/graph-db-client run test -- tests/e2e-system.test.ts',
    args: (jsonOut) => npmWorkspaceRun('@vt/graph-db-client', 'test', [...vitestJsonArgs(jsonOut), 'tests/e2e-system.test.ts']),
    parser: 'vitest',
}
