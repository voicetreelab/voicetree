import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'vt-daemon-unit',
    name: 'vt-daemon Unit',
    category: 'Unit',
    display: 'npm --workspace @vt/vt-daemon run test',
    args: (jsonOut) => checkArgs.npmWorkspaceRun('@vt/vt-daemon', 'test', checkArgs.vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
