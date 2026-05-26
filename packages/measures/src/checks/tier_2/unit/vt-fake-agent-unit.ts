import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'vt-fake-agent-unit',
    name: 'vt-fake-agent Unit',
    category: 'Unit',
    display: 'npm run test:vt-fake-agent',
    args: (jsonOut) => checkArgs.npmRun('test:vt-fake-agent', checkArgs.vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
