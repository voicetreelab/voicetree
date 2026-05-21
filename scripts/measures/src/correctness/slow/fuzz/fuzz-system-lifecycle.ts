import {type CheckDef, E2E_TIMEOUT_MS, npmRun, vitestJsonArgs} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'fuzz-system-lifecycle',
    name: 'Fuzz: system lifecycle',
    category: 'Integration',
    display: 'npm run test:fuzz -- packages/systems/graph-db-server/tests/system-lifecycle.fuzz.test.ts',
    args: (jsonOut) => npmRun('test:fuzz', [...vitestJsonArgs(jsonOut), 'packages/systems/graph-db-server/tests/system-lifecycle.fuzz.test.ts']),
    parser: 'vitest',
    slow: true,
    timeoutMs: E2E_TIMEOUT_MS,
}
