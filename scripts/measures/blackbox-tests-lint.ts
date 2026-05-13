import {type CheckDef, npmRun} from './_types.ts'

export const check: CheckDef = {
    id: 'blackbox-tests-lint',
    name: 'Blackbox Test Lint',
    category: 'Lint',
    display: 'npm run lint:blackbox-tests',
    args: () => npmRun('lint:blackbox-tests'),
    parser: 'none',
}
