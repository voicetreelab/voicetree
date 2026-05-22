import {type CheckDef} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'blackbox-tests-lint',
    name: 'Blackbox Test Lint',
    category: 'Lint',
    display: 'npx vitest run packages/measures/src/checks/tier_0/lint/blackbox-tests.test.ts',
    args: () => ['npx', 'vitest', 'run', 'packages/measures/src/checks/tier_0/lint/blackbox-tests.test.ts'],
    parser: 'none',
}
