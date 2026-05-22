import {type CheckDef, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'ci-coverage',
    name: 'CI Coverage Drift Detector',
    category: 'Static',
    display: 'vitest run packages/measures/src/health/meta/ci-coverage.test.ts',
    args: (jsonOut) => ['npx', 'vitest', 'run', 'packages/measures/src/health/meta/ci-coverage.test.ts', ...vitestJsonArgs(jsonOut)],
    parser: 'vitest',
}
