// Tier 2 workflow spec. Integration + fuzz + browser tier-2 E2E.
// Depends on tier 0 (pre-commit gating signals) and tier 1 (foundational
// unit/structure checks).

import type {WorkflowSpec} from '../_workflow-types.ts'

export const workflow: WorkflowSpec = {
    needs: ['tier_0_pre_commit', 'tier_1'],
    runner: 'ubuntu-latest',
    setup: {
        playwright: false,
        xvfb: false,
        node: '22',
    },
    trigger: {
        baseRef: null,
    },
    protection: {
        requiredOn: ['dev', 'main'],
        conditionalOn: [],
    },
    precheck: null,
    parallelism: 'per-concern',
    sequential: false,
}
