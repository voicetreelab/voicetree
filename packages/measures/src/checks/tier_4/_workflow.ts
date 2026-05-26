// Tier 4 workflow spec. Deep analyzers (mutation, dead-code, duplication)
// gated on the `tier4-precheck` job (PR size + freshness of last successful
// nightly Tier-4 run on main). Only runs on PRs targeting main.

import type {WorkflowSpec} from '../_workflow-types.ts'

export const workflow: WorkflowSpec = {
    needs: ['tier_3'],
    runner: 'ubuntu-latest',
    setup: {
        playwright: false,
        xvfb: false,
        node: '22',
    },
    trigger: {
        baseRef: 'main',
    },
    protection: {
        requiredOn: [],
        conditionalOn: ['main'],
    },
    precheck: 'tier4-precheck',
    parallelism: 'per-concern',
    sequential: false,
}
