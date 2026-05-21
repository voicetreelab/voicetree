import {type CheckDef, npmRun, vitestJsonArgs} from '../../_types.ts'

export const check: CheckDef = {
    id: 'systems-health',
    name: 'Systems Health Suite',
    category: 'Unit',
    display: 'npm run test:codebase-health',
    args: (jsonOut) => npmRun('test:codebase-health', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
