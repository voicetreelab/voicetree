import {type CheckDef, npmRun} from '../../_types.ts'

export const check: CheckDef = {
    id: 'complexity',
    name: 'Complexity Health',
    category: 'Static',
    display: 'npm run health:complexity',
    args: () => npmRun('health:complexity'),
    parser: 'none',
}
