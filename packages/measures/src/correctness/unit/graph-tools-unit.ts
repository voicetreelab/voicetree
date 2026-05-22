import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from '../../_types.ts'

export const check: CheckDef = {
    id: 'graph-tools-unit',
    name: 'Graph Tools Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/graph-tools run test',
    args: (jsonOut) => npmWorkspaceRun('@vt/graph-tools', 'test', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
    // CLI/vt-headless tests time out under nested full-suite parallelism.
    exclusive: true,
}
