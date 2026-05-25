import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'fuzz-session-state',
    name: 'Fuzz: session state',
    category: 'Integration',
    display: 'npm run test:fuzz -- packages/systems/graph-db-server/tests/session-state.fuzz.test.ts',
    args: (jsonOut) => checkArgs.npmRun('test:fuzz', [...checkArgs.vitestJsonArgs(jsonOut), 'packages/systems/graph-db-server/tests/session-state.fuzz.test.ts']),
    parser: 'vitest',
    timeoutMs: checkArgs.e2eTimeoutMs,
}
