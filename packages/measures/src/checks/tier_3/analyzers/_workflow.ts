// tier_3/analyzers/ concern override: incremental Stryker mutation. No
// Playwright or xvfb needed — Stryker uses vitest, not browsers. Sequential
// because the two mutation runs share git diff state and bench-test the
// same node_modules concurrently if parallel.

import type {WorkflowSpec} from '../../_workflow-types.ts'

export const workflow: WorkflowSpec = {
    needs: ['tier_2'],
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
