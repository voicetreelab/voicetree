import {type CheckDef, npmRun} from './_types.ts'

export const check: CheckDef = {
    id: 'root-lint',
    name: 'Root ESLint',
    category: 'Lint',
    display: 'npm run lint',
    args: () => npmRun('lint'),
    parser: 'none',
}
