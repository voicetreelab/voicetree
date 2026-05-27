import {type CheckDef} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'verify-cytoscape-rules',
    name: 'Cytoscape Lint Rules',
    category: 'Lint',
    display: 'npx vitest run packages/measures/src/checks/tier_2/lint/verify-cytoscape-lint-rules.test.ts --testTimeout=60000',
    args: () => ['npx', 'vitest', 'run', 'packages/measures/src/checks/tier_2/lint/verify-cytoscape-lint-rules.test.ts', '--testTimeout=60000'],
    parser: 'none',
    exclusive: true,
}
