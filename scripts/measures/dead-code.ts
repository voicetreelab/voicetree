import {type CheckDef, npmRun} from './_types.ts'

export const check: CheckDef = {
    id: 'dead-code',
    name: 'Dead Code (knip)',
    category: 'Static',
    display: 'npm run check:dead-code',
    args: () => npmRun('check:dead-code'),
    parser: 'none',
}
