import {type CheckDef} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'verify-cytoscape-rules',
    name: 'Cytoscape Lint Rules',
    category: 'Lint',
    // tier_0 per schedule migration; Phase 4 wall-clock decides whether its dashboard ~32s duration needs promotion.
    display: 'npx vitest run packages/measures/src/checks/tier_0/lint/verify-cytoscape-lint-rules.test.ts --testTimeout=60000',
    args: () => ['npx', 'vitest', 'run', 'packages/measures/src/checks/tier_0/lint/verify-cytoscape-lint-rules.test.ts', '--testTimeout=60000'],
    parser: 'none',
    exclusive: true,
}
