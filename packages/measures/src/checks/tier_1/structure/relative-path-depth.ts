import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'relative-path-depth',
    name: 'Relative Path Depth',
    category: 'Static',
    display: 'vitest run packages/measures/src/health/shape/relative-path-depth.test.ts',
    args: (jsonOut) => [
        'npx',
        'vitest',
        'run',
        'packages/measures/src/health/shape/relative-path-depth.test.ts',
        ...checkArgs.vitestJsonArgs(jsonOut),
    ],
    parser: 'vitest',
}
