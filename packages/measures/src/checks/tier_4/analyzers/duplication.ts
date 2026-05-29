import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'duplication',
    name: 'Code Duplication (jscpd)',
    category: 'Static',
    display: 'pnpm --filter @vt/measures run measures:duplication',
    args: () => checkArgs.npmWorkspaceRun('@vt/measures', 'measures:duplication'),
    parser: 'none',
}
