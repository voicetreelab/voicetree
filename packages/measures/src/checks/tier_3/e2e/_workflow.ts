// tier_3/e2e/ concern override: Electron E2E uses shared app/runtime state,
// ports, and display resources, so capture-ci must run it sequentially.

import type {WorkflowSpec} from '../../_workflow-types.ts'

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
    precheck: null,
    parallelism: 'per-concern',
    sequential: true,
}
