// tier_2/e2e/ concern override: browser tier-2 + cross-process integration
// suites need Playwright chromium installed and serialized daemon/port access.

import type {WorkflowSpec} from '../../_workflow-types.ts'

export const workflow: WorkflowSpec = {
    needs: ['tier_0_pre_commit', 'tier_1'],
    runner: 'ubuntu-latest',
    setup: {
        playwright: true,
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
