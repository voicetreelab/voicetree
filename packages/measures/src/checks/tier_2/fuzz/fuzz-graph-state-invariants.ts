import {type CheckDef, E2E_TIMEOUT_MS, npmRun, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'fuzz-graph-state-invariants',
    name: 'Fuzz: graph-state invariants',
    category: 'Integration',
    display: 'npm run test:fuzz -- packages/libraries/graph-state/tests/invariants.fuzz.test.ts',
    args: (jsonOut) => npmRun('test:fuzz', [...vitestJsonArgs(jsonOut), 'packages/libraries/graph-state/tests/invariants.fuzz.test.ts']),
    parser: 'vitest',
    timeoutMs: E2E_TIMEOUT_MS,
}
