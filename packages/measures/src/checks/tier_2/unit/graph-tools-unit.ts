import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'graph-tools-unit',
    name: 'Graph Tools Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/graph-tools run test',
    args: (jsonOut) => checkArgs.npmWorkspaceRun('@vt/graph-tools', 'test', checkArgs.vitestJsonArgs(jsonOut)),
    parser: 'vitest',
    // CLI/vt-headless tests time out under nested full-suite parallelism.
    exclusive: true,
}
