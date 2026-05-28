import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'orange-gate',
    name: 'Orange Complexity Gate',
    category: 'Unit',
    display: 'pnpm --filter @vt/measures exec vitest run src/health/complexity/hierarchical-complexity.test.ts src/health/complexity/behavioral-complexity.test.ts src/health/complexity/shape-complexity.test.ts',
    args: (jsonOut) => checkArgs.npmWorkspaceExec(
        '@vt/measures',
        'vitest',
        'run',
        'src/health/complexity/hierarchical-complexity.test.ts',
        'src/health/complexity/behavioral-complexity.test.ts',
        'src/health/complexity/shape-complexity.test.ts',
        ...checkArgs.vitestJsonArgs(jsonOut),
    ),
    parser: 'vitest',
}
