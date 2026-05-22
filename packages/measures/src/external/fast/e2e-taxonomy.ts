import {type CheckDef, npmRun} from '../../_types.ts'

export const check: CheckDef = {
    id: 'e2e-taxonomy',
    name: 'E2E Taxonomy',
    category: 'Static',
    display: 'npm run check:e2e-taxonomy',
    args: () => npmRun('check:e2e-taxonomy'),
    parser: 'none',
}
