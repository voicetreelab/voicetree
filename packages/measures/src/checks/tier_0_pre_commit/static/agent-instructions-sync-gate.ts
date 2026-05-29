import {type CheckDef} from '../../_types.ts'

const SCRIPT_PATH = 'packages/measures/scripts/agent-instructions-sync.mjs'

export const check: CheckDef = {
    id: 'agent-instructions-sync',
    name: 'CLAUDE.md / AGENTS.md byte-sync',
    category: 'Static',
    display: `node ${SCRIPT_PATH}`,
    args: () => ['node', SCRIPT_PATH],
    parser: 'none',
}
