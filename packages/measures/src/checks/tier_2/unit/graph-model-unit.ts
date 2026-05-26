import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'graph-model-unit',
    name: 'Graph Model Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/graph-model run test',
    args: (jsonOut) => checkArgs.npmWorkspaceRun('@vt/graph-model', 'test', checkArgs.vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
