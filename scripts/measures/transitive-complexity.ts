import {type CheckDef, npmRun} from './_types.ts'

export const check: CheckDef = {
    id: 'transitive-complexity',
    name: 'Transitive Complexity (CodeQL)',
    category: 'Static',
    display: 'npm run health:transitive-complexity',
    args: () => npmRun('health:transitive-complexity'),
    parser: 'none',
    slow: true,
}
