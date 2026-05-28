// Tier 0 (pre-commit) workflow spec. Lint, agent-instructions-sync,
// e2e-taxonomy — all pure static checks that run before anything else.
// No deps, runs unconditionally on every PR.
//
// See packages/measures/src/_runners/workflow-types.ts for field semantics.

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
