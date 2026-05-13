import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from './_types.ts'

export const check: CheckDef = {
    id: 'graph-state-unit',
    name: 'Graph State Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/graph-state run test',
    args: (jsonOut) => npmWorkspaceRun('@vt/graph-state', 'test', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
