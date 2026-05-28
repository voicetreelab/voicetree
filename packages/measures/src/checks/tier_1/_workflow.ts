// Tier 1 workflow spec. Coverage/structure/typecheck/health/e2e-smoke —
// most fast unit-shaped checks. Independent of tier 0 (runs in parallel with
// it in the same wave). Concerns that need extra setup (e.g. e2e/) override
// via their own _workflow.ts.

import type {WorkflowSpec} from '../_workflow-types.ts'

export const workflow: WorkflowSpec = {
    needs: [],
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
