// tier_1/e2e/ concern override: browser & electron smokes need Playwright.

import type {WorkflowSpec} from '../../_workflow-types.ts'

export const workflow: WorkflowSpec = {
    needs: [],
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
    sequential: false,
}
