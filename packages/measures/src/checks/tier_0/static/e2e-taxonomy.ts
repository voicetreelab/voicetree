import {type CheckDef, npmWorkspaceRun} from '../../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-taxonomy',
    name: 'E2E Taxonomy',
    category: 'Static',
    display: 'npm --workspace webapp run check:e2e-taxonomy',
    args: () => npmWorkspaceRun('webapp', 'check:e2e-taxonomy'),
    parser: 'none',
}
