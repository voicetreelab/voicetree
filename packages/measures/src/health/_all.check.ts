export const check = {
    id: 'systems-health',
    name: 'Systems Health Suite',
    category: 'Unit',
    display: 'pnpm --filter @vt/measures run test',
    args: (jsonOut: string | null) => [
        'node',
        '--no-warnings=ExperimentalWarning',
        '--experimental-strip-types',
        'packages/measures/src/_runners/run-systems-health.ts',
        ...(jsonOut === null ? [] : [`--outputFile=${jsonOut}`]),
    ],
    parser: 'vitest',
} as const
