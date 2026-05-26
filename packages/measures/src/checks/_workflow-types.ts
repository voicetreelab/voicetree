// Source-of-truth shape for the CI workflow generator.
//
// Each `tier_N/_workflow.ts` (and optional `tier_N/<concern>/_workflow.ts`)
// exports a `workflow: WorkflowSpec` describing how to translate that folder
// into one or more GitHub Actions jobs. `packages/measures/scripts/gen-workflows.mjs`
// discovers these declarations and emits `.github/workflows/measures-budget-gate.yml`.
//
// Why this lives in `checks/` and not `_runners/`:
//   The `_workflow.ts` files all import from this module. Keeping the type
//   inside `measures/checks/` makes those imports intra-community — no
//   cross-community fan-out into `measures/_runners`. The generator script
//   (outside `src/`) and the drift test (in `measures/health/`) are the
//   only external consumers.
//
// Why this exists:
//   The legacy hand-written PR workflow didn't map cleanly to the tier-folder
//   taxonomy — single jobs spanned multiple tiers, and the budget gate at the
//   end could only see sibling reports written within the SAME
//   `capture-ci-checks` invocation. Now each `tier_N/<concern>/` is its own
//   GHA job with uploaded check-report artifacts, and a final `budget-gate`
//   job downloads them all and runs the per-tier wall-clock check.

// Parallelism strategies declared at the concern level.
//   per-concern → one GHA job runs every check in the concern folder
//                 (--only=<comma list of check ids>).
//   per-check   → one GHA job per check (matrix.check_id ∈ folder); used for
//                 the fuzz suites which already run in a 5-way matrix today.
type ConcernParallelism = 'per-concern' | 'per-check'

type WorkflowSetup = {
    // Run `npx playwright install --with-deps chromium` (working-directory: webapp).
    readonly playwright: boolean
    // Wrap the capture-ci step in `xvfb-run -a -s "-screen 0 1280x1024x24"` for
    // headed Electron tests on Linux runners.
    readonly xvfb: boolean
    // Node major version passed to actions/setup-node@v4.
    readonly node: string
}

type WorkflowTrigger = {
    // null = always; 'main' = only PRs where github.base_ref == 'main'.
    readonly baseRef: string | null
}

type WorkflowProtection = {
    // Branches where this tier's generated jobs are directly required by
    // GitHub rulesets. Declared at tier level; concern overrides inherit it.
    readonly requiredOn: readonly string[]
    // Branches where this tier is conditionally required by its precheck. The
    // tier job itself is not a stable required status context; budget-gate
    // enforces whether the conditional skip/run decision was correct.
    readonly conditionalOn: readonly string[]
}

export type WorkflowSpec = {
    // Names of other tier folders this tier depends on (e.g. 'tier_1').
    // Concern-level overrides may narrow this; defaults inherit from the tier.
    readonly needs: readonly string[]
    // GHA runner label (ubuntu-latest, etc.).
    readonly runner: string
    // Setup steps shared across all jobs for this tier/concern.
    readonly setup: WorkflowSetup
    // Trigger conditions.
    readonly trigger: WorkflowTrigger
    // Branch-protection policy for this tier. Optional only so concern-level
    // overrides can inherit the tier declaration without restating it.
    readonly protection?: WorkflowProtection
    // Job-id to gate this tier/concern on (decision-only precheck, e.g.
    // tier4-precheck). null = no precheck.
    readonly precheck: string | null
    // How to split this tier/concern across GHA jobs.
    readonly parallelism: ConcernParallelism
    // Run checks one at a time within the capture-ci process. Set true for
    // concerns that share resources such as daemons, ports, or databases.
    readonly sequential: boolean
}
