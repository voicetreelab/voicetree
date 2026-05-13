import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from './_types.ts'

export const check: CheckDef = {
    id: 'graph-model-unit',
    name: 'Graph Model Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/graph-model run test',
    args: (jsonOut) => npmWorkspaceRun('@vt/graph-model', 'test', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
