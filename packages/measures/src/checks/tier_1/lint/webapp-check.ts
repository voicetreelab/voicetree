import {type CheckDef, npmWorkspaceRun} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'webapp-check',
    name: 'Webapp TypeCheck + E2E Taxonomy',
    category: 'TypeCheck',
    display: 'npm --workspace webapp run check',
    args: () => npmWorkspaceRun('webapp', 'check'),
    parser: 'none',
}
