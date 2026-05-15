import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from '../../_types.ts'

export const check: CheckDef = {
    id: 'graph-db-server-unit',
    name: 'Graph DB Server Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/graph-db-server run test',
    args: (jsonOut) => npmWorkspaceRun('@vt/graph-db-server', 'test', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
