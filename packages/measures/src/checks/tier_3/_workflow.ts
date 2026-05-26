// Tier 3 workflow spec. Heavier electron E2E. Depends on tier 2 results.
// Needs xvfb + Playwright for headed Electron on Linux runners.

import type {WorkflowSpec} from '../_workflow-types.ts'

export const workflow: WorkflowSpec = {
    needs: ['tier_2'],
    runner: 'ubuntu-latest',
    setup: {
        playwright: true,
        xvfb: true,
        node: '22',
    },
    trigger: {
        baseRef: null,
    },
    protection: {
        requiredOn: ['main'],
        conditionalOn: [],
    },
    precheck: null,
    parallelism: 'per-concern',
    sequential: false,
}
