import {type CheckDef, E2E_TIMEOUT_MS, npmRun, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'fuzz-graph-delta',
    name: 'Fuzz: graph delta HTTP API',
    category: 'Integration',
    display: 'npm run test:fuzz -- packages/systems/graph-db-server/tests/graph-delta.fuzz.test.ts',
    args: (jsonOut) => npmRun('test:fuzz', [...vitestJsonArgs(jsonOut), 'packages/systems/graph-db-server/tests/graph-delta.fuzz.test.ts']),
    parser: 'vitest',
    timeoutMs: E2E_TIMEOUT_MS,
}
