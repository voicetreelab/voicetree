import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'graph-tools-e2e-system',
    name: 'Graph Tools E2E System Contract',
    category: 'Integration',
    display: 'npm --workspace @vt/graph-tools run test -- tests/system/e2e-system.test.ts',
    args: (jsonOut) => checkArgs.npmWorkspaceRun('@vt/graph-tools', 'test', [...checkArgs.vitestJsonArgs(jsonOut), 'tests/system/e2e-system.test.ts']),
    parser: 'vitest',
}
