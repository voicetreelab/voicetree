import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'fuzz-graph-delta',
    name: 'Fuzz: graph delta HTTP API',
    category: 'Integration',
    display: 'pnpm exec vitest run --config vitest.config.fuzz.ts packages/systems/graph-db-server/tests/graph-delta.fuzz.test.ts',
    args: (jsonOut) => checkArgs.fuzzVitestArgs(jsonOut, 'packages/systems/graph-db-server/tests/graph-delta.fuzz.test.ts'),
    parser: 'vitest',
    timeoutMs: checkArgs.e2eTimeoutMs,
}
