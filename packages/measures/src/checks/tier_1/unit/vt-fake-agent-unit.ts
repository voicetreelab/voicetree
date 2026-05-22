import {type CheckDef, npmRun, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'vt-fake-agent-unit',
    name: 'vt-fake-agent Unit',
    category: 'Unit',
    display: 'npm run test:vt-fake-agent',
    args: (jsonOut) => npmRun('test:vt-fake-agent', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
