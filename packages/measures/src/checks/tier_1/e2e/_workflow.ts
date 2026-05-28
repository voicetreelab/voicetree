// tier_1/e2e/ concern override: browser & electron smokes need Playwright.
// Keep each smoke in its own matrix job so the tier_1 wall-clock budget measures
// the slower smoke, not the sum of two independent startup-heavy suites.

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
    parallelism: 'per-check',
    sequential: false,
}
