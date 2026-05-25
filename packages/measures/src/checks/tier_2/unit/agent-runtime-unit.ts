import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'agent-runtime-unit',
    name: 'Agent Runtime Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/agent-runtime run test',
    args: (jsonOut) => checkArgs.npmWorkspaceRun('@vt/agent-runtime', 'test', checkArgs.vitestJsonArgs(jsonOut)),
    parser: 'vitest',
    // Real tmux-backed tests time out under nested full-suite parallelism.
    exclusive: true,
}
