import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'fuzz-graph-state-invariants',
    name: 'Fuzz: graph-state invariants',
    category: 'Integration',
    display: 'pnpm exec vitest run --config vitest.config.fuzz.ts packages/libraries/graph-state/tests/invariants/invariants.fuzz.test.ts',
    args: (jsonOut) => checkArgs.fuzzVitestArgs(jsonOut, 'packages/libraries/graph-state/tests/invariants/invariants.fuzz.test.ts'),
    parser: 'vitest',
    timeoutMs: checkArgs.e2eTimeoutMs,
}
