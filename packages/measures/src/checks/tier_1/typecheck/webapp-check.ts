import {checkArgs, type CheckDef} from '../../_types.ts'

export const check: CheckDef = {
    id: 'webapp-check',
    name: 'Webapp TypeCheck + E2E Taxonomy',
    category: 'TypeCheck',
    display: 'npm --workspace webapp run check',
    args: () => checkArgs.npmWorkspaceRun('webapp', 'check'),
    parser: 'none',
}
