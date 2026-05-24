import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from '../_types.ts'

export const check: CheckDef = {
    id: 'systems-health',
    name: 'Systems Health Suite',
    category: 'Unit',
    display: 'npm --workspace @vt/measures run test',
    args: (jsonOut) => npmWorkspaceRun('@vt/measures', 'test', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
