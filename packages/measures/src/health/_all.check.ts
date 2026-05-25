export const check = {
    id: 'systems-health',
    name: 'Systems Health Suite',
    category: 'Unit',
    display: 'npm --workspace @vt/measures run test',
    args: (jsonOut: string | null) => [
        'npm',
        '--workspace',
        '@vt/measures',
        'run',
        'test',
        '--',
        ...(jsonOut === null ? ['--reporter=json'] : ['--reporter=json', `--outputFile=${jsonOut}`]),
    ],
    parser: 'vitest',
} as const
