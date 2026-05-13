import {type CheckDef, npmRun, vitestJsonArgs} from './_types.ts'

export const check: CheckDef = {
    id: 'orange-gate',
    name: 'Orange Complexity Gate',
    category: 'Unit',
    display: 'npm run orange-codebase-complexity-tests',
    args: (jsonOut) => npmRun('orange-codebase-complexity-tests', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
