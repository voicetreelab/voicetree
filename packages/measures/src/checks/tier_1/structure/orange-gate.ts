import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'orange-gate',
    name: 'Orange Complexity Gate',
    category: 'Unit',
    display: 'npm run orange-codebase-complexity-tests',
    args: (jsonOut) => checkArgs.npmRun('orange-codebase-complexity-tests', checkArgs.vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
