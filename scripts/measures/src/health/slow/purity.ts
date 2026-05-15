import {type CheckDef, npmRun} from '../../_types.ts'

export const check: CheckDef = {
    id: 'purity',
    name: 'Transitive Purity (CodeQL)',
    category: 'Static',
    display: 'npm run health:purity',
    args: () => npmRun('health:purity'),
    parser: 'none',
    slow: true,
}
