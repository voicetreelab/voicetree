import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'graph-state-unit',
    name: 'Graph State Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/graph-state run test',
    args: (jsonOut) => npmWorkspaceRun('@vt/graph-state', 'test', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
    // The graph-state suite includes the 10k invariant fuzzer. Keep that
    // wall-clock-sensitive CPU work out of the nested tier-1 parallel phase.
    exclusive: true,
}
