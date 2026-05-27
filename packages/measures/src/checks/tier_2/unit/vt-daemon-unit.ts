import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'vt-daemon-unit',
    name: 'vt-daemon Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/vt-daemon run test',
    args: (jsonOut) => npmWorkspaceRun('@vt/vt-daemon', 'test', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
