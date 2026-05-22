import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from '../../_types.ts'

export const check: CheckDef = {
    id: 'graph-tools-e2e-system',
    name: 'Graph Tools E2E System Contract',
    category: 'Integration',
    display: 'npm --workspace @vt/graph-tools run test -- tests/e2e-system.test.ts',
    args: (jsonOut) => npmWorkspaceRun('@vt/graph-tools', 'test', [...vitestJsonArgs(jsonOut), 'tests/e2e-system.test.ts']),
    parser: 'vitest',
}
