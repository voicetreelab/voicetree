// tier_2/fuzz/ concern override: emit one matrix job per fuzz check so each
// runs with full timeout isolation.

import type {WorkflowSpec} from '../../_workflow-types.ts'

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
    precheck: null,
    parallelism: 'per-check',
    sequential: false,
}
