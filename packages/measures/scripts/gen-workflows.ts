// CI workflow generator. Reads the folder tree under packages/measures/src/checks/
// and emits .github/workflows/measures-budget-gate.yml — one GHA job per
// `tier_N/<concern>/` folder, plus a final `budget-gate` job that downloads
// every tier's check-report artifacts and runs `check-tier-budgets.ts`.
//
// Architecture (per CLAUDE.md — functional core, imperative shell):
//   discoverTiers()       → impure I/O, reads folder tree + check IDs
//   tierSpecsToWorkflow() → pure transform, SpecMap → WorkflowYaml
//   workflowYamlToText()  → pure formatter, WorkflowYaml → string
//   generate()            → shell, composes the three + writes the file
//
// Why this file is not activated:
//   `on: workflow_dispatch: {}` only. The hand-written `stage1-checks.yml`
//   remains the real PR gate until a follow-up PR cuts over.

import {readdir, readFile, writeFile, mkdir} from 'node:fs/promises'
import {dirname, join, resolve, relative} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

import type {WorkflowSpec} from '../src/checks/_workflow-types.ts'

const SCRIPT_DIR: string = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT: string = resolve(SCRIPT_DIR, '..')
const REPO_ROOT: string = resolve(PKG_ROOT, '..', '..')
const CHECKS_DIR: string = join(PKG_ROOT, 'src', 'checks')
const OUTPUT_PATH: string = join(REPO_ROOT, '.github', 'workflows', 'measures-budget-gate.yml')

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

// Internal IR — what the pure transform emits, fed to the pure formatter.
// Kept structural so equality is trivial.
type Step =
    | {kind: 'checkout'}
    | {kind: 'setup-node'; node: string}
    | {kind: 'npm-ci'}
    | {kind: 'playwright-install'}
    | {kind: 'run'; name: string; run: string}
    | {kind: 'upload-artifact'; name: string; path: string}
    | {kind: 'download-artifact'; pattern: string; path: string}

type Job = {
    readonly id: string
    readonly name: string
    readonly runsOn: string
    readonly needs: readonly string[]
    readonly ifExpr: string | null
    readonly strategy: {readonly matrix: {readonly check_id: readonly string[]}} | null
    readonly outputs: Record<string, string> | null
    readonly steps: readonly Step[]
}

export type WorkflowYaml = {
    readonly name: string
    readonly jobs: readonly Job[]
}

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
            const effective: WorkflowSpec = concernSpec ?? tierSpec
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
    jobs.push(budgetGateJob(jobs, maxTier))

    return {name: 'Measures (generated)', jobs}
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

function captureCiStep(conc: ConcernSpec): Step {
    const cmd = captureCiCommand(conc.tierNumber, conc.checkIds.join(','), conc.spec.sequential)
    const wrapped = conc.spec.setup.xvfb
        ? `xvfb-run -a -s "-screen 0 1280x1024x24" \\\n${cmd}`
        : cmd
    return {kind: 'run', name: `Run ${jobIdFor(conc.tier, conc.concern)} checks`, run: wrapped}
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
    return {kind: 'run', name: `Run ${jobIdFor(conc.tier, conc.concern)} check`, run: wrapped}
}

function commonSetupSteps(conc: ConcernSpec): readonly Step[] {
    const steps: Step[] = [
        {kind: 'checkout'},
        {kind: 'setup-node', node: conc.spec.setup.node},
        {kind: 'npm-ci'},
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

function precheckJob(jobId: string, trigger: WorkflowSpec['trigger']): Job {
    // Self-contained decision job — equivalent to the hand-written
    // `mutation-gate` in stage1-checks.yml. PR size + freshness of the last
    // nightly Tier-4 carrier together gate Tier 4 on PRs into main.
    const decideScript = [
        'set -euo pipefail',
        'ADDED=$(git diff --shortstat "$BASE_SHA...$HEAD_SHA" \\',
        '        | grep -oE \'[0-9]+ insertion\' | grep -oE \'[0-9]+\' || echo 0)',
        'ADDED=${ADDED:-0}',
        'echo "PR added $ADDED lines"',
        '',
        'if [ "$ADDED" -lt "$LARGE_FLOOR" ]; then',
        '  echo "should_run=false" >> "$GITHUB_OUTPUT"',
        '  echo "reason=PR is small ($ADDED < $LARGE_FLOOR lines)" >> "$GITHUB_OUTPUT"',
        '  exit 0',
        'fi',
        '',
        'if [ "$ADDED" -ge "$LARGE_CEILING" ]; then',
        '  echo "should_run=true" >> "$GITHUB_OUTPUT"',
        '  echo "reason=huge PR ($ADDED >= $LARGE_CEILING lines)" >> "$GITHUB_OUTPUT"',
        '  exit 0',
        'fi',
        '',
        'LAST=""',
        'for sha in $(git rev-list -n 100 origin/main); do',
        '  LAST=$(gh api "repos/$REPO/commits/$sha/check-runs" \\',
        '         --jq \'.check_runs[] | select(.name=="Main CI / Full" and .conclusion=="success") | .completed_at\' \\',
        '         | head -n1)',
        '  [ -n "$LAST" ] && break',
        'done',
        '',
        'if [ -z "$LAST" ]; then',
        '  echo "should_run=true" >> "$GITHUB_OUTPUT"',
        '  echo "reason=no successful Main CI / Full found on main in last 100 commits" >> "$GITHUB_OUTPUT"',
        '  exit 0',
        'fi',
        '',
        'AGE_DAYS=$(( ( $(date +%s) - $(date -d "$LAST" +%s) ) / 86400 ))',
        'if [ "$AGE_DAYS" -gt "$STALE_DAYS" ]; then',
        '  echo "should_run=true" >> "$GITHUB_OUTPUT"',
        '  echo "reason=stale (${AGE_DAYS}d > ${STALE_DAYS}d) and PR is $ADDED lines" >> "$GITHUB_OUTPUT"',
        'else',
        '  echo "should_run=false" >> "$GITHUB_OUTPUT"',
        '  echo "reason=Tier 4 fresh (${AGE_DAYS}d <= ${STALE_DAYS}d) and PR under huge threshold" >> "$GITHUB_OUTPUT"',
        'fi',
    ].join('\n')
    return {
        id: jobId,
        name: jobId,
        runsOn: 'ubuntu-latest',
        needs: [],
        ifExpr: trigger.baseRef ? `github.base_ref == '${trigger.baseRef}'` : null,
        strategy: null,
        outputs: {should_run: '${{ steps.decide.outputs.should_run }}', reason: '${{ steps.decide.outputs.reason }}'},
        steps: [
            {kind: 'checkout'},
            {kind: 'run', name: 'decide', run: decideScript},
        ],
    }
}

function budgetGateJob(tierJobs: readonly Job[], maxTier: number): Job {
    const tierJobIds = tierJobs
        .filter(j => /^tier-\d/.test(j.id))
        .map(j => j.id)
        .sort()
    return {
        id: 'budget-gate',
        name: 'budget-gate',
        runsOn: 'ubuntu-latest',
        needs: tierJobIds,
        ifExpr: 'always()',
        strategy: null,
        outputs: null,
        steps: [
            {kind: 'checkout'},
            {kind: 'setup-node', node: '22'},
            {kind: 'npm-ci'},
            {kind: 'download-artifact', pattern: 'reports-*', path: 'health-dashboard/reports/checks/'},
            {
                kind: 'run',
                name: `Run tier budget gate (max tier ${maxTier})`,
                run: [
                    'node --no-warnings=ExperimentalWarning --experimental-strip-types \\',
                    '  packages/measures/src/_runners/check-tier-budgets.ts',
                ].join('\n'),
            },
        ],
    }
}

// ── Pure: WorkflowYaml → text ────────────────────────────────────────────────

const HEADER = [
    '# AUTO-GENERATED by packages/measures/scripts/gen-workflows.ts',
    '# from tier_N/_workflow.ts. Do not edit by hand.',
    '# Run `npm run gen:workflows` to regenerate.',
    '# Not activated — workflow_dispatch only until cut-over in follow-up PR.',
].join('\n')

export function workflowYamlToText(yaml: WorkflowYaml): string {
    const lines: string[] = []
    lines.push(HEADER)
    lines.push(`name: ${yamlString(yaml.name)}`)
    lines.push('')
    lines.push('on:')
    lines.push('  workflow_dispatch: {}')
    lines.push('')
    lines.push('jobs:')
    for (const job of yaml.jobs) {
        lines.push(...renderJob(job))
        lines.push('')
    }
    return lines.join('\n').replace(/\n+$/, '\n')
}

function renderJob(job: Job): readonly string[] {
    const lines: string[] = []
    lines.push(`  ${job.id}:`)
    lines.push(`    name: ${yamlString(job.name)}`)
    if (job.needs.length > 0) {
        lines.push(`    needs: [${job.needs.join(', ')}]`)
    }
    if (job.ifExpr !== null) {
        lines.push(`    if: ${yamlString(job.ifExpr)}`)
    }
    lines.push(`    runs-on: ${job.runsOn}`)
    if (job.strategy) {
        lines.push('    strategy:')
        lines.push('      fail-fast: false')
        lines.push('      matrix:')
        lines.push('        check_id:')
        for (const id of job.strategy.matrix.check_id) {
            lines.push(`          - ${id}`)
        }
    }
    if (job.outputs) {
        lines.push('    outputs:')
        for (const [key, value] of Object.entries(job.outputs).sort(([a], [b]) => a.localeCompare(b))) {
            lines.push(`      ${key}: ${yamlString(value)}`)
        }
    }
    lines.push('    steps:')
    for (const step of job.steps) {
        lines.push(...renderStep(step).map(l => `      ${l}`))
    }
    return lines
}

function renderStep(step: Step): readonly string[] {
    switch (step.kind) {
        case 'checkout': return ['- uses: actions/checkout@v4']
        case 'setup-node': return [
            '- uses: actions/setup-node@v4',
            '  with:',
            `    node-version: '${step.node}'`,
            '    cache: npm',
            '    cache-dependency-path: package-lock.json',
        ]
        case 'npm-ci': return [
            '- name: Install dependencies',
            '  run: npm ci',
        ]
        case 'playwright-install': return [
            '- name: Install Playwright chromium',
            '  working-directory: webapp',
            '  run: npx playwright install --with-deps chromium',
        ]
        case 'run': return renderRun(step.name, step.run, null)
        case 'upload-artifact': return [
            '- name: Upload check reports',
            '  if: always()',
            '  uses: actions/upload-artifact@v4',
            '  with:',
            `    name: ${step.name}`,
            `    path: ${step.path}`,
            '    retention-days: 1',
        ]
        case 'download-artifact': return [
            '- name: Download all check reports',
            '  uses: actions/download-artifact@v4',
            '  with:',
            `    pattern: ${step.pattern}`,
            `    path: ${step.path}`,
            '    merge-multiple: true',
        ]
    }
}

function renderRun(name: string, body: string, id: string | null): readonly string[] {
    const out: string[] = [`- name: ${yamlString(name)}`]
    if (id) out.push(`  id: ${id}`)
    out.push('  run: |')
    for (const line of body.split('\n')) out.push(`    ${line}`)
    return out
}

function yamlString(s: string): string {
    if (/^[A-Za-z0-9_\-./]+$/.test(s)) return s
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
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
