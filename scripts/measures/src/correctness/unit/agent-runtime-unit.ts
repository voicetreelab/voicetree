import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from '../../_types.ts'

export const check: CheckDef = {
    id: 'agent-runtime-unit',
    name: 'Agent Runtime Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/agent-runtime run test',
    args: (jsonOut) => npmWorkspaceRun('@vt/agent-runtime', 'test', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
    // Real tmux-backed tests time out under nested full-suite parallelism.
    exclusive: true,
}
