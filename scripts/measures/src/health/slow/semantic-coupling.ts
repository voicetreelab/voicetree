import {type CheckDef, npmRun} from '../../_types.ts'

export const check: CheckDef = {
    id: 'semantic-coupling',
    name: 'Semantic Coupling (CodeQL)',
    category: 'Static',
    display: 'npm run health:semantic-coupling',
    args: () => npmRun('health:semantic-coupling'),
    parser: 'none',
    slow: true,
}
