import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'root-lint',
    name: 'Root ESLint',
    category: 'Lint',
    display: 'npm run lint',
    args: () => checkArgs.npmRun('lint'),
    parser: 'none',
}
