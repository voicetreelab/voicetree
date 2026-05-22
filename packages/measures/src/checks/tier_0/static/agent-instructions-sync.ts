import {type CheckDef, npmRun} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'agent-instructions-sync',
    name: 'CLAUDE.md / AGENTS.md byte-sync',
    category: 'Static',
    display: 'npm run check:agent-instructions-sync',
    args: () => npmRun('check:agent-instructions-sync'),
    parser: 'none',
}
