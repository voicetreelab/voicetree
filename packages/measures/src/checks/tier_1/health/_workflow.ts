// tier_1/health/ concern override: the duplication health gates
// (duplication-mass, semantic-duplication, workflow-duplication) shell out to
// the native `vt-dup` Rust binary, so this job builds it first (cached).
// Scoped here rather than at the tier so the other tier-1 concerns
// (coverage/structure/typecheck) don't pay for a Rust toolchain build.

import type {WorkflowSpec} from '../../_workflow-types.ts'

export const workflow: WorkflowSpec = {
    needs: [],
    runner: 'ubuntu-latest',
    setup: {
        playwright: false,
        xvfb: false,
        node: '22',
        native: true,
    },
    trigger: {
        baseRef: null,
    },
    precheck: null,
    parallelism: 'per-concern',
    sequential: false,
}
