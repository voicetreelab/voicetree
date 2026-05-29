import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'vt-fake-agent-unit',
    name: 'vt-fake-agent Unit',
    category: 'Unit',
    display: 'pnpm --filter vt-fake-agent run test',
    args: (jsonOut) => checkArgs.npmWorkspaceRun('vt-fake-agent', 'test', checkArgs.vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
