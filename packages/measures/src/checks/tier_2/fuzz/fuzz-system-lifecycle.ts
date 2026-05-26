import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'fuzz-system-lifecycle',
    name: 'Fuzz: system lifecycle',
    category: 'Integration',
    display: 'npm run test:fuzz -- packages/systems/graph-db-server/tests/system-lifecycle.fuzz.test.ts',
    args: (jsonOut) => checkArgs.npmRun('test:fuzz', [...checkArgs.vitestJsonArgs(jsonOut), 'packages/systems/graph-db-server/tests/system-lifecycle.fuzz.test.ts']),
    parser: 'vitest',
    timeoutMs: checkArgs.e2eTimeoutMs,
}
