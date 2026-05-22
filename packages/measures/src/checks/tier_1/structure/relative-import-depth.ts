import {type CheckDef, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'relative-import-depth',
    name: 'Relative Import Depth',
    category: 'Static',
    display: 'vitest run packages/measures/src/health/coupling/relative-import-depth.test.ts',
    args: (jsonOut) => [
        'npx',
        'vitest',
        'run',
        'packages/measures/src/health/coupling/relative-import-depth.test.ts',
        ...vitestJsonArgs(jsonOut),
    ],
    parser: 'vitest',
}
