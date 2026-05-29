// CI workflow generator. Reads the folder tree under packages/measures/src/checks/
// and emits .github/workflows/measures-budget-gate.generated.yml — one GHA job per
// `tier_N/<concern>/` folder, plus a final `budget-gate` job that downloads
// every tier's check-report artifacts and runs the tier-4 budget gate.
//
// Architecture (per CLAUDE.md — functional core, imperative shell):
//   discoverTiers()       → impure I/O, reads folder tree + check IDs
//   tierSpecsToWorkflow() → pure transform, SpecMap → WorkflowYaml
//   workflowYamlToText()  → pure formatter, WorkflowYaml → string
//   generate()            → shell, composes the three + writes the file
//
// Triggers: `workflow_dispatch` + every `pull_request`. Branch protection is
// derived from tier-level WorkflowSpec.protection declarations, not from path
// filters in the generated workflow.

import {readdir, readFile, writeFile, mkdir} from 'node:fs/promises'
import {dirname, join, resolve, relative} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

import type {WorkflowSpec} from '../src/checks/_workflow-types.ts'

import type {Job, Step, WorkflowYaml} from './gen-workflows/_types.ts'
import {precheckJob} from './gen-workflows/precheck-job.ts'
import {workflowYamlToText} from './gen-workflows/render.ts'

export type {WorkflowYaml}
// `export {x} from '...'` form is intentional: the name-uniqueness extractor
// skips re-exports-with-source so this convenience re-export does not
// collide with the underlying `export function workflowYamlToText` in render.ts.
export {workflowYamlToText} from './gen-workflows/render.ts'

const SCRIPT_DIR: string = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT: string = resolve(SCRIPT_DIR, '..')
const REPO_ROOT: string = resolve(PKG_ROOT, '..', '..')
const CHECKS_DIR: string = join(PKG_ROOT, 'src', 'checks')
const OUTPUT_PATH: string = join(REPO_ROOT, '.github', 'workflows', 'measures-budget-gate.generated.yml')

// ── Types ────────────────────────────────────────────────────────────────────

// One concern (e.g. tier_1/coverage) flattened with the effective WorkflowSpec
// after concern-level overrides have been applied on top of the tier default.
export type ConcernSpec = {
    readonly tier: string            // e.g. 'tier_1' (folder name)
    readonly tierNumber: number      // tier digit (0..4)
    readonly concern: string         // e.g. 'coverage'
    readonly checkIds: readonly string[] // sorted unique check ids in this concern
    readonly spec: WorkflowSpec      // effective spec (tier default ⊕ concern override)
}

export type TierSpecs = {
    // Stable iteration order: tier ascending, concern alphabetical.
    readonly concerns: readonly ConcernSpec[]
    // All tier folder names participating (e.g. ['tier_0_pre_commit', 'tier_1', ...]).
    // Used to compute `budget-gate.needs` and `<tier>.needs` membership.
    readonly tierFolderNames: readonly string[]
}

export type RequiredContextsByBaseRef = Record<string, readonly string[]>

// ── Pure: discovery helpers used by both shell and tests ─────────────────────

const TIER_FOLDER_RE = /^tier_\d+(?:_pre_commit)?$/

export function tierNumberOf(folder: string): number {
    const m = /^tier_(\d+)/.exec(folder)
    if (!m) throw new Error(`not a tier folder: ${folder}`)
    return Number(m[1])
}

// ── Impure: file-system discovery ────────────────────────────────────────────

export async function discoverTiers(checksDir: string = CHECKS_DIR): Promise<TierSpecs> {
    const tierEntries = (await readdir(checksDir, {withFileTypes: true}))
        .filter(e => e.isDirectory() && TIER_FOLDER_RE.test(e.name))
        .map(e => e.name)
        .sort(compareTierFolders)

    const concerns: ConcernSpec[] = []
    for (const tier of tierEntries) {
        const tierSpec = await loadWorkflowSpec(join(checksDir, tier, '_workflow.ts'))
        if (!tierSpec) continue
        const concernEntries = (await readdir(join(checksDir, tier), {withFileTypes: true}))
            .filter(e => e.isDirectory() && !e.name.startsWith('_'))
            .map(e => e.name)
            .sort()
        for (const concern of concernEntries) {
            const concernSpec = await loadWorkflowSpec(join(checksDir, tier, concern, '_workflow.ts'))
            const effective: WorkflowSpec = mergeWorkflowSpec(tierSpec, concernSpec)
            const checkIds = await loadCheckIds(join(checksDir, tier, concern))
            if (checkIds.length === 0) continue
            concerns.push({
                tier,
                tierNumber: tierNumberOf(tier),
                concern,
                checkIds,
                spec: effective,
            })
        }
    }
    return {concerns, tierFolderNames: tierEntries}
}

function mergeWorkflowSpec(tierSpec: WorkflowSpec, concernSpec: WorkflowSpec | null): WorkflowSpec {
    if (!concernSpec) return tierSpec
    return {
        ...tierSpec,
        ...concernSpec,
        setup: {...tierSpec.setup, ...concernSpec.setup},
        trigger: {...tierSpec.trigger, ...concernSpec.trigger},
        protection: concernSpec.protection ?? tierSpec.protection,
    }
}

function compareTierFolders(a: string, b: string): number {
    const an = tierNumberOf(a)
    const bn = tierNumberOf(b)
    if (an !== bn) return an - bn
    return a.localeCompare(b)
}

async function loadWorkflowSpec(path: string): Promise<WorkflowSpec | null> {
    try {
        const mod = await import(pathToFileURL(path).href) as {workflow?: WorkflowSpec}
        return mod.workflow ?? null
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ERR_MODULE_NOT_FOUND' || code === 'ENOENT') return null
        throw err
    }
}

async function loadCheckIds(concernDir: string): Promise<readonly string[]> {
    let entries: readonly {isFile(): boolean; name: string}[]
    try {
        entries = await readdir(concernDir, {withFileTypes: true})
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
    }
    const ids: string[] = []
    for (const e of entries) {
        if (!e.isFile()) continue
        if (!e.name.endsWith('.ts')) continue
        if (e.name.endsWith('.test.ts')) continue
        if (e.name.startsWith('_') && e.name !== '_all.check.ts') continue
        const mod = await import(pathToFileURL(join(concernDir, e.name)).href) as {check?: {id?: string}}
        const id = mod.check?.id
        if (typeof id === 'string' && id.length > 0) ids.push(id)
    }
    return [...new Set(ids)].sort()
}

// ── Pure: transform TierSpecs → WorkflowYaml IR ──────────────────────────────

export function tierSpecsToWorkflow(input: TierSpecs): WorkflowYaml {
    const tierDigits = new Set(input.tierFolderNames.map(tierNumberOf))
    const maxTier = tierDigits.size === 0 ? 0 : Math.max(...tierDigits)

    const jobs: Job[] = []
    const precheckJobIds = new Set<string>()

    // Emit precheck jobs first (one per unique precheck declared across concerns).
    for (const conc of input.concerns) {
        if (!conc.spec.precheck) continue
        if (precheckJobIds.has(conc.spec.precheck)) continue
        precheckJobIds.add(conc.spec.precheck)
        jobs.push(precheckJob(conc.spec.precheck, conc.spec.trigger))
    }

    // Per-concern (or per-check matrix) jobs.
    for (const conc of input.concerns) {
        if (conc.spec.parallelism === 'per-check') {
            jobs.push(perCheckMatrixJob(conc, input))
        } else {
            jobs.push(perConcernJob(conc, input))
        }
    }

    // Final budget-gate job: depends on every tier job, runs always.
    jobs.push(budgetGateJob(jobs, maxTier, input))

    return {name: 'Measures (generated)', jobs}
}

export function requiredStatusContextsByBaseRef(input: TierSpecs): RequiredContextsByBaseRef {
    return mapValuesSorted(requiredJobContextsByBaseRef(input, 'status-context'))
}

export function requiredJobIdsByBaseRef(input: TierSpecs): RequiredContextsByBaseRef {
    return mapValuesSorted(requiredJobContextsByBaseRef(input, 'job-id'))
}

export function conditionalJobIdsByBaseRef(input: TierSpecs): RequiredContextsByBaseRef {
    const out = new Map<string, Set<string>>()
    for (const conc of input.concerns) {
        for (const baseRef of conc.spec.protection?.conditionalOn ?? []) {
            addToMapSet(out, baseRef, jobIdFor(conc.tier, conc.concern))
        }
    }
    return mapSetsSorted(out)
}

export function conditionalPrecheckByJobId(input: TierSpecs): Record<string, string> {
    const out: Record<string, string> = {}
    for (const conc of input.concerns) {
        if (!conc.spec.precheck) continue
        if ((conc.spec.protection?.conditionalOn ?? []).length === 0) continue
        out[jobIdFor(conc.tier, conc.concern)] = conc.spec.precheck
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

function requiredJobContextsByBaseRef(
    input: TierSpecs,
    mode: 'job-id' | 'status-context',
): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>()
    const protectedBranches = new Set<string>()
    for (const conc of input.concerns) {
        for (const baseRef of conc.spec.protection?.requiredOn ?? []) {
            protectedBranches.add(baseRef)
            const contexts = mode === 'job-id'
                ? [jobIdFor(conc.tier, conc.concern)]
                : statusContextsForConcern(conc)
            for (const context of contexts) addToMapSet(out, baseRef, context)
        }
    }
    for (const baseRef of protectedBranches) addToMapSet(out, baseRef, 'budget-gate')
    return out
}

function statusContextsForConcern(conc: ConcernSpec): readonly string[] {
    const id = jobIdFor(conc.tier, conc.concern)
    if (conc.spec.parallelism !== 'per-check') return [id]
    return conc.checkIds.map(checkId => `${id} (${checkId})`)
}

function addToMapSet(map: Map<string, Set<string>>, key: string, value: string): void {
    const existing = map.get(key)
    if (existing) existing.add(value)
    else map.set(key, new Set([value]))
}

function mapValuesSorted(map: Map<string, Set<string>>): RequiredContextsByBaseRef {
    return Object.fromEntries(
        [...map.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, values]) => [key, [...values].sort()]),
    )
}

function mapSetsSorted(map: Map<string, Set<string>>): RequiredContextsByBaseRef {
    return mapValuesSorted(map)
}

function jobIdFor(tier: string, concern: string): string {
    return `${tier.replace(/_/g, '-')}-${concern.replace(/_/g, '-')}`
}

function needsJobIds(conc: ConcernSpec, input: TierSpecs): readonly string[] {
    // A tier's "needs" listed in WorkflowSpec are tier folder names; expand
    // those to all concern-jobs under those tiers.
    const needsTiers = new Set(conc.spec.needs)
    const ids = input.concerns
        .filter(c => needsTiers.has(c.tier))
        .map(c => jobIdFor(c.tier, c.concern))
    if (conc.spec.precheck) ids.push(conc.spec.precheck)
    return [...new Set(ids)].sort()
}

function ifExprFor(conc: ConcernSpec): string | null {
    const parts: string[] = []
    if (conc.spec.trigger.baseRef !== null) parts.push(`github.base_ref == '${conc.spec.trigger.baseRef}'`)
    if (conc.spec.precheck) parts.push(`needs.${conc.spec.precheck}.outputs.should_run == 'true'`)
    return parts.length === 0 ? null : parts.join(' && ')
}

// 4 GiB heap per vitest worker covers the heaviest health checks
// (systems-health's semantic-duplication clusters all 4906 repo functions
// through the call-graph builder; the default ~2.6 GiB Node 22 heap on
// ubuntu-latest OOMs after the 2026-05-28 pnpm migration changed worker
// scheduling). Sized to stay under the runner's 7 GiB total when vitest
// runs 2 forks in parallel — 6 GiB tripped swap-thrash on the previous
// attempt. Applied to every captureCi step rather than scoped to
// tier-1-health alone so future tiers don't hit the same wall silently.
const CAPTURE_CI_NODE_OPTIONS = '--max-old-space-size=4096'

function captureCiStep(conc: ConcernSpec): Step {
    const cmd = captureCiCommand(conc.tierNumber, conc.checkIds.join(','), conc.spec.sequential)
    const wrapped = conc.spec.setup.xvfb
        ? `xvfb-run -a -s "-screen 0 1280x1024x24" \\\n${cmd}`
        : cmd
    return {
        kind: 'run',
        name: `Run ${jobIdFor(conc.tier, conc.concern)} checks`,
        run: wrapped,
        env: {NODE_OPTIONS: CAPTURE_CI_NODE_OPTIONS},
    }
}

function captureCiCommand(tierMax: number, only: string, sequential: boolean): string {
    return [
        'node --no-warnings=ExperimentalWarning --experimental-strip-types',
        '  packages/measures/src/_runners/capture-ci-checks.ts',
        `  --tier-max=${tierMax}`,
        ...(sequential ? ['  --sequential'] : []),
        `  --only=${only}`,
    ].join(' \\\n')
}

function captureCiMatrixStep(conc: ConcernSpec): Step {
    // matrix variant: --only=${{ matrix.check_id }}.
    const cmd = captureCiCommand(conc.tierNumber, '${{ matrix.check_id }}', true)
    const wrapped = conc.spec.setup.xvfb
        ? `xvfb-run -a -s "-screen 0 1280x1024x24" \\\n${cmd}`
        : cmd
    return {
        kind: 'run',
        name: `Run ${jobIdFor(conc.tier, conc.concern)} check`,
        run: wrapped,
        env: {NODE_OPTIONS: CAPTURE_CI_NODE_OPTIONS},
    }
}

function commonSetupSteps(conc: ConcernSpec): readonly Step[] {
    const steps: Step[] = [
        {kind: 'checkout'},
        {kind: 'pnpm-setup'},
        {kind: 'setup-node', node: conc.spec.setup.node},
        {kind: 'install-deps'},
    ]
    if (conc.spec.setup.playwright) steps.push({kind: 'playwright-install'})
    return steps
}

function perConcernJob(conc: ConcernSpec, input: TierSpecs): Job {
    const id = jobIdFor(conc.tier, conc.concern)
    const artifactName = `reports-${id}`
    return {
        id,
        name: id,
        runsOn: conc.spec.runner,
        needs: needsJobIds(conc, input),
        ifExpr: ifExprFor(conc),
        strategy: null,
        outputs: null,
        steps: [
            ...commonSetupSteps(conc),
            captureCiStep(conc),
            {kind: 'upload-artifact', name: artifactName, path: 'health-dashboard/reports/checks/'},
        ],
    }
}

function perCheckMatrixJob(conc: ConcernSpec, input: TierSpecs): Job {
    const id = jobIdFor(conc.tier, conc.concern)
    const artifactName = `reports-${id}-\${{ matrix.check_id }}`
    return {
        id,
        name: `${id} (\${{ matrix.check_id }})`,
        runsOn: conc.spec.runner,
        needs: needsJobIds(conc, input),
        ifExpr: ifExprFor(conc),
        strategy: {matrix: {check_id: conc.checkIds}},
        outputs: null,
        steps: [
            ...commonSetupSteps(conc),
            captureCiMatrixStep(conc),
            {kind: 'upload-artifact', name: artifactName, path: 'health-dashboard/reports/checks/'},
        ],
    }
}

function budgetGateJob(upstreamJobs: readonly Job[], maxTier: number, input: TierSpecs): Job {
    const upstreamJobIds = upstreamJobs
        .filter(j => j.id !== 'budget-gate')
        .map(j => j.id)
        .sort()
    return {
        id: 'budget-gate',
        name: 'budget-gate',
        runsOn: 'ubuntu-latest',
        needs: upstreamJobIds,
        ifExpr: 'always()',
        strategy: null,
        outputs: null,
        steps: [
            {kind: 'checkout'},
            {kind: 'pnpm-setup'},
            {kind: 'setup-node', node: '22'},
            {kind: 'install-deps'},
            {kind: 'download-artifact', pattern: 'reports-*', path: 'health-dashboard/reports/checks/'},
            {
                kind: 'run',
                name: `Run tier budget gate (max tier ${maxTier})`,
                run: [
                    'node --no-warnings=ExperimentalWarning --experimental-strip-types \\',
                    '  packages/measures/scripts/check-tier-budgets.ts',
                ].join('\n'),
                env: {
                    GITHUB_BASE_REF: '${{ github.base_ref }}',
                    MEASURES_WORKFLOW_NEEDS_JSON: '${{ toJson(needs) }}',
                    MEASURES_REQUIRED_JOBS_BY_BASE_REF: JSON.stringify(requiredJobIdsByBaseRef(input)),
                    MEASURES_CONDITIONAL_JOBS_BY_BASE_REF: JSON.stringify(conditionalJobIdsByBaseRef(input)),
                    MEASURES_CONDITIONAL_PRECHECK_BY_JOB_ID: JSON.stringify(conditionalPrecheckByJobId(input)),
                },
            },
        ],
    }
}

// ── Shell ────────────────────────────────────────────────────────────────────

async function generate(): Promise<void> {
    const specs = await discoverTiers(CHECKS_DIR)
    const yaml = tierSpecsToWorkflow(specs)
    const text = workflowYamlToText(yaml)
    await mkdir(dirname(OUTPUT_PATH), {recursive: true})
    await writeFile(OUTPUT_PATH, text, 'utf8')
    console.log(`wrote ${relative(REPO_ROOT, OUTPUT_PATH)}  (${yaml.jobs.length} jobs)`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    generate().catch(err => { console.error(err); process.exit(1) })
}
