import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'fuzz-session-state',
    name: 'Fuzz: session state',
    category: 'Integration',
    display: 'pnpm exec vitest run --config vitest.config.fuzz.ts packages/systems/graph-db-server/tests/session-state.fuzz.test.ts',
    args: (jsonOut) => checkArgs.fuzzVitestArgs(jsonOut, 'packages/systems/graph-db-server/tests/session-state.fuzz.test.ts'),
    parser: 'vitest',
    timeoutMs: checkArgs.e2eTimeoutMs,
}
