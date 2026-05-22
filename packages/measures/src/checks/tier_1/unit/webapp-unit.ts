import {type CheckDef, npmWorkspaceExec, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'webapp-unit',
    name: 'Webapp Unit (vitest)',
    category: 'Unit',
    display: 'npm --workspace webapp exec -- vitest run',
    args: (jsonOut) => npmWorkspaceExec('webapp', 'vitest', 'run', ...vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
