// tier_2/contract/ concern override: public API contract tests touch shared
// graph state and must not run concurrently inside a capture-ci process.

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
    parallelism: 'per-concern',
    sequential: true,
}
