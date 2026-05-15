import {type CheckDef, npmRun} from '../../_types.ts'

export const check: CheckDef = {
    id: 'duplication',
    name: 'Code Duplication (jscpd)',
    category: 'Static',
    display: 'npm run health:duplication',
    args: () => npmRun('health:duplication'),
    parser: 'none',
}
