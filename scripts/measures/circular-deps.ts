import {type CheckDef, npmRun} from './_types.ts'

export const check: CheckDef = {
    id: 'circular-deps',
    name: 'Circular Dependencies',
    category: 'Static',
    display: 'npm run check:circular-deps',
    args: () => npmRun('check:circular-deps'),
    parser: 'none',
}
