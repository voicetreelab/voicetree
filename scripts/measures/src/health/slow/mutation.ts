import {type CheckDef, E2E_TIMEOUT_MS, npmRun} from '../../_types.ts'

export const check: CheckDef = {
    id: 'mutation',
    name: 'Mutation Testing (Stryker)',
    category: 'Other',
    display: 'npm run health:mutation',
    args: () => npmRun('health:mutation'),
    parser: 'none',
    slow: true,
    timeoutMs: E2E_TIMEOUT_MS,
}
