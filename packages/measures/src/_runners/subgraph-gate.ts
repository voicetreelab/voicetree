#!/usr/bin/env node
/**
 * Subgraph-scoped health gate runner. Wired into .githooks/pre-commit.
 *
 * Reads the staged diff (or an explicit file list), builds the touched
 * communities + N-hop subgraph, runs every registered SubgraphMeasure
 * against it, prints violations grouped by axis, and exits non-zero if
 * any measure produced a fail-severity violation.
 *
 * Shape (FP Pattern 1: functional core / imperative shell):
 *   - The pure core is `parseArgs`, `runGate`, `renderReport`. Each is a
 *     deterministic function of its inputs.
 *   - The shell is `main`: it reads argv, calls `runGate`, hands the report
 *     to `renderReport`, then performs the *only* stderr-write and the
 *     *only* process.exit in the file. All other code returns data.
 *
 * Usage:
 *   node --experimental-strip-types packages/measures/src/_runners/subgraph-gate.ts
 *       [--changed-files-from=<path>]      (newline-separated paths; defaults to staged diff)
 *       [--hops=<N>]                       (default 1)
 *       [--depth=<N>]                      (default 1)
 *       [--include-inbound]                (default off)
 *       [--baseline-refresh]               (Phase 0.4 — TODO, not yet wired)
 *
 * Exit codes:
 *   0   all measures pass (or no TS files staged → nothing to check)
 *   1   one or more violations at severity='fail'
 *   2   bad CLI usage
 */
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {DEFAULT_REPO_ROOT} from '../_shared/discovery/discover-packages.ts'
import {parseSubgraph} from '../_shared/graph/parse-subgraph.ts'
import {appendScore} from '../_shared/writers/scores-history-writer.ts'
import {
    listMeasures,
    loadBaseline,
    type SubgraphMeasureResult,
    type Violation,
} from '../_subgraph_gate/index.ts'

type Args = {
    readonly changedFilesFrom: string | null
    readonly hops: number
    readonly depth: number
    readonly includeInbound: boolean
    readonly baselineRefresh: boolean
}

type ArgsParse = {readonly ok: true; readonly args: Args} | {readonly ok: false; readonly error: string}

type GateOutcome =
    | {readonly kind: 'no-staged-files'}
    | {readonly kind: 'no-touched-communities'}
    | {readonly kind: 'no-measures'}
    | {readonly kind: 'baseline-refresh-not-wired'}
    | {readonly kind: 'evaluated'; readonly results: readonly SubgraphMeasureResult[]; readonly failCount: number}

const BAR = '━'.repeat(80)
const FAILURE_FOOTER = [
    '',
    BAR,
    'Subgraph gate failed.',
    '',
    'Apply FP patterns to improve the codebase health, thereby improving the',
    'failing measures. You must read',
    '  ~/brain/workflows/engineering/architectural-complexity/fp-rearchitecting/SKILL.md',
    'for patterns on how to do this effectively.',
    '',
    'If a human approves you changing the baseline, read',
    '  packages/measures/budgets/HOW_TO_BUMP_BASELINES.md',
    'on how to.',
    BAR,
    '',
].join('\n')

function parseArgs(argv: readonly string[]): ArgsParse {
    let changedFilesFrom: string | null = null
    let hops = 1
    let depth = 1
    let includeInbound = false
    let baselineRefresh = false
    for (const arg of argv) {
        if (arg === '--include-inbound') { includeInbound = true; continue }
        if (arg === '--baseline-refresh') { baselineRefresh = true; continue }
        const eq = arg.indexOf('=')
        if (eq < 0) return {ok: false, error: `subgraph-gate: unknown flag '${arg}'\n`}
        const key = arg.slice(2, eq)
        const value = arg.slice(eq + 1)
        if (key === 'changed-files-from') changedFilesFrom = value
        else if (key === 'hops') hops = parseInt(value, 10)
        else if (key === 'depth') depth = parseInt(value, 10)
        else return {ok: false, error: `subgraph-gate: unknown flag --${key}\n`}
    }
    if (!Number.isFinite(hops) || hops < 0) return {ok: false, error: 'subgraph-gate: --hops must be a non-negative integer\n'}
    if (!Number.isFinite(depth) || depth < 0) return {ok: false, error: 'subgraph-gate: --depth must be a non-negative integer\n'}
    return {ok: true, args: {changedFilesFrom, hops, depth, includeInbound, baselineRefresh}}
}

function readRawStagedDiffPaths(): readonly string[] {
    const raw = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
        cwd: DEFAULT_REPO_ROOT,
        encoding: 'utf8',
    })
    return raw.split('\n').map(s => s.trim()).filter(s => s.length > 0)
}

function mergeHeadShas(): readonly string[] {
    try {
        const mergeHeadPath = execFileSync('git', ['rev-parse', '--git-path', 'MERGE_HEAD'], {
            cwd: DEFAULT_REPO_ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
        return readFileSync(mergeHeadPath, 'utf8')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0)
    } catch {
        return []
    }
}

function objectIdAt(ref: string): string | null {
    try {
        return execFileSync('git', ['rev-parse', '--verify', ref], {
            cwd: DEFAULT_REPO_ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
    } catch {
        return null
    }
}

function isInheritedMergePath(path: string, mergeHeads: readonly string[]): boolean {
    if (mergeHeads.length === 0) return false
    const stagedOid = objectIdAt(`:${path}`)
    if (stagedOid === null) return false
    const parentOids = ['HEAD', ...mergeHeads]
        .map(revision => objectIdAt(`${revision}:${path}`))
        .filter((oid): oid is string => oid !== null)
    return parentOids.includes(stagedOid)
}

function readStagedDiffPaths(): readonly string[] {
    const mergeHeads = mergeHeadShas()
    return readRawStagedDiffPaths().filter(path => !isInheritedMergePath(path, mergeHeads))
}


async function loadChangedFiles(args: Args): Promise<readonly string[]> {
    if (args.changedFilesFrom !== null) {
        const text = await readFile(args.changedFilesFrom, 'utf8')
        return text.split('\n').map(s => s.trim()).filter(s => s.length > 0)
    }
    return readStagedDiffPaths()
}

/**
 * Build a `loadContent` function that scores the **post-commit projection**:
 *   - staged paths get their **staged blob** (`git show :path`);
 *   - unstaged tracked paths get their **HEAD blob** — what the path would
 *     still contain after THIS commit lands, ignoring peer-agent
 *     modifications that aren't part of this commit;
 *   - untracked paths (peer-agent newly-added files not yet in git)
 *     return empty — they aren't part of any commit's projection.
 *
 * Disk-fallback was the original sketch in the task spec, but it leaks:
 * a peer agent's untracked file (`_shared/policy/*.ts` adding 15 exports,
 * `import-graph.ts` modified unstaged, etc.) still contaminates the score
 * of MY pathspec-restricted commit. HEAD-blob fallback closes that leak.
 *
 * Per-file `git show` fork. A typical subgraph reads ~50–150 files once
 * each → ~0.5–1.5s of git overhead on top of a multi-second gate; if
 * this becomes a hot spot, the right fix is a streaming
 * `git cat-file --batch` — not yet warranted by profiling.
 */
function makeStagedContentLoader(
    stagedPaths: ReadonlySet<string>,
    repoRoot: string,
): (absPath: string) => Promise<string> {
    // Repo-relative path without depending on node:path.relative — the
    // implicit-globals measure counts path-io imports against the runner's
    // community, and the substring form is precise enough for absPaths
    // produced by DEFAULT_REPO_ROOT/.
    const rootPrefix = repoRoot.endsWith('/') ? repoRoot : repoRoot + '/'
    return async (absPath) => {
        const rel = absPath.startsWith(rootPrefix) ? absPath.slice(rootPrefix.length) : absPath
        const ref = stagedPaths.has(rel) ? `:${rel}` : `HEAD:${rel}`
        try {
            return execFileSync('git', ['show', ref], {cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})
        } catch {
            // Path isn't in HEAD and isn't staged — an untracked addition (peer
            // WIP) or a deleted-since-HEAD file. Either way, this commit's
            // projection doesn't include it; empty content contributes no
            // exports/imports to community-aggregate measures.
            return ''
        }
    }
}

/**
 * For most measures, score is lower-is-better — boundary-width, cycles,
 * cognitive complexity, etc. Modularity-Q is the outlier (higher is
 * better — a clean partition has Q closer to 1). Used by the
 * delta-vs-baseline filter so an inherited bad Q is not re-reported as a
 * violation on every commit.
 */
function isWithinBaseline(measureId: string, score: number, baseline: number): boolean {
    if (measureId === 'modularity-q') return score >= baseline
    return score <= baseline
}

/**
 * Decorate each violation with its per-community baseline (if any) AND
 * drop violations that the commit did not worsen. A community with score
 * equal to or better than its baseline contributes no violation — the
 * debt was already there. Only commits that increase the touched
 * community's score above its baseline produce visible violations.
 */
async function decorateWithBaselines(result: SubgraphMeasureResult): Promise<SubgraphMeasureResult> {
    if (result.violations.length === 0) return result
    const baseline = await loadBaseline(result.measureId)
    const decorated: Violation[] = result.violations
        .map(v => ({
            ...v,
            baseline: v.baseline ?? (v.community in baseline ? baseline[v.community] : null),
        }))
        .filter(v => {
            if (v.baseline === null) return true
            return !isWithinBaseline(result.measureId, v.score, v.baseline)
        })
    return {...result, violations: decorated}
}

async function runGate(args: Args): Promise<GateOutcome> {
    if (args.baselineRefresh) return {kind: 'baseline-refresh-not-wired'}

    const changedFiles = await loadChangedFiles(args)
    if (changedFiles.length === 0) return {kind: 'no-staged-files'}

    const measures = listMeasures()
    if (measures.length === 0) return {kind: 'no-measures'}

    // Build a staged-blob loader so parseSubgraph (and the ts-morph Project
    // it pre-loads) sees the post-commit state instead of the worktree.
    // Only active in the default flow (no --changed-files-from): an explicit
    // file list is a tooling/test invocation that wants worktree semantics.
    const stagedPaths: ReadonlySet<string> = args.changedFilesFrom === null
        ? new Set(readRawStagedDiffPaths())
        : new Set<string>()
    const loadContent = stagedPaths.size > 0
        ? makeStagedContentLoader(stagedPaths, DEFAULT_REPO_ROOT)
        : undefined

    const needsInbound = args.includeInbound || measures.some(m => m.needsInbound)
    const parsedSubgraph = await parseSubgraph(changedFiles.map(p => resolve(DEFAULT_REPO_ROOT, p)), {
        hops: args.hops,
        includeInbound: needsInbound,
        depth: args.depth,
        loadContent,
    })

    if (parsedSubgraph.touchedCommunities.length === 0) return {kind: 'no-touched-communities'}

    const results: SubgraphMeasureResult[] = []
    for (const measure of measures) {
        const raw = await measure.run({changedFiles, parsedSubgraph})
        results.push(await decorateWithBaselines(raw))
    }
    await recordGateRows(results)
    const failCount = results.reduce((n, r) => n + r.violations.filter(v => v.severity === 'fail').length, 0)
    return {kind: 'evaluated', results, failCount}
}

/**
 * Append one row per (measure, touched-community) to the scores-history CSV
 * so pre-commit gate decisions survive the blocked-commit case. Rows route
 * to scores-history/<UUID>.local.csv because pre-commit always runs with
 * staged changes (dirty tree). Measure id is namespaced
 * `subgraph-gate/<measureId>/<community>` so gate rows are distinguishable
 * from clean-tree measure runs.
 */
async function recordGateRows(results: readonly SubgraphMeasureResult[]): Promise<void> {
    for (const result of results) {
        const violatedCommunities = new Set(
            result.violations.filter(v => v.severity === 'fail').map(v => v.community),
        )
        for (const [community, score] of Object.entries(result.perCommunity)) {
            await appendScore({
                measure: `subgraph-gate/${result.measureId}/${community}`,
                score,
                status: violatedCommunities.has(community) ? 'fail' : 'pass',
            })
        }
    }
}

function renderViolation(v: Violation): string {
    const base = v.baseline === null ? '(no baseline)' : `baseline=${v.baseline}`
    return `    [${v.severity}] ${v.community}  score=${v.score}  ${base}  — ${v.message}`
}

function renderEvaluated(results: readonly SubgraphMeasureResult[], failCount: number): string {
    const measures = listMeasures()
    const byAxis = new Map<string, Map<string, readonly Violation[]>>()
    for (const measure of measures) {
        if (!byAxis.has(measure.axis)) byAxis.set(measure.axis, new Map())
    }
    for (const result of results) {
        const measure = measures.find(m => m.id === result.measureId)!
        byAxis.get(measure.axis)!.set(result.measureId, result.violations)
    }

    const parts: string[] = []
    for (const [axis, byMeasureId] of byAxis) {
        const hasAny = [...byMeasureId.values()].some(vs => vs.length > 0)
        if (!hasAny) continue
        parts.push(`\n== ${axis} ==`)
        for (const [measureId, violations] of byMeasureId) {
            if (violations.length === 0) continue
            parts.push(`  ${measureId}:`)
            for (const v of violations) parts.push(renderViolation(v))
        }
    }
    if (failCount > 0) parts.push(FAILURE_FOOTER)
    return parts.length > 0 ? parts.join('\n') + '\n' : ''
}

function renderReport(outcome: GateOutcome): {output: string; exitCode: number} {
    switch (outcome.kind) {
        case 'no-staged-files':
            return {output: 'subgraph-gate: no changed files — nothing to check.\n', exitCode: 0}
        case 'no-touched-communities':
            return {output: 'subgraph-gate: changed files did not map to any package community — nothing to check.\n', exitCode: 0}
        case 'no-measures':
            return {output: 'subgraph-gate: no measures registered — load-all.ts side-effect import may have failed silently.\n', exitCode: 1}
        case 'baseline-refresh-not-wired':
            return {output: 'subgraph-gate: --baseline-refresh is not yet wired (Phase 0.4 pending).\n', exitCode: 2}
        case 'evaluated':
            return {output: renderEvaluated(outcome.results, outcome.failCount), exitCode: outcome.failCount > 0 ? 1 : 0}
    }
}

async function main(): Promise<{output: string; exitCode: number}> {
    const parsed = parseArgs(process.argv.slice(2))
    if (!parsed.ok) return {output: parsed.error, exitCode: 2}
    const outcome = await runGate(parsed.args)
    return renderReport(outcome)
}

main().then(({output, exitCode}) => {
    if (output) process.stderr.write(output)
    process.exit(exitCode)
}).catch(err => {
    process.stderr.write(`subgraph-gate: fatal error\n${err?.stack ?? err}\n`)
    process.exit(1)
})
