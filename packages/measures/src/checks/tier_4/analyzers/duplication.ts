import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'duplication',
    name: 'Code Duplication (jscpd)',
    category: 'Static',
    display: 'npm run measures:duplication',
    args: () => checkArgs.npmRun('measures:duplication'),
    parser: 'none',
}
