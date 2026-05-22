import {type CheckDef, npmRun} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'duplication',
    name: 'Code Duplication (jscpd)',
    category: 'Static',
    display: 'npm run measures:duplication',
    args: () => npmRun('measures:duplication'),
    parser: 'none',
}
