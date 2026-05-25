import {type CheckDef, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'architecture-drift',
    name: 'Architecture Drift',
    category: 'Static',
    display: 'vitest run packages/measures/src/health/coupling/architecture-drift.test.ts',
    args: (jsonOut) => [
        'npx',
        'vitest',
        'run',
        'packages/measures/src/health/coupling/architecture-drift.test.ts',
        ...vitestJsonArgs(jsonOut),
    ],
    parser: 'vitest',
}
