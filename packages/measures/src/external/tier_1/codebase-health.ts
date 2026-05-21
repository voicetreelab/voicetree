import {type CheckDef, npmWorkspaceRun, vitestJsonArgs} from '../../_types.ts'

export const check: CheckDef = {
    id: 'codebase-health',
    name: 'Codebase Health Workspace',
    category: 'Unit',
    display: 'npm --workspace @vt/codebase-health run test',
    args: (jsonOut) => npmWorkspaceRun('@vt/codebase-health', 'test', vitestJsonArgs(jsonOut)),
    parser: 'vitest',
}
