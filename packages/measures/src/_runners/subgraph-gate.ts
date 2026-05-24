#!/usr/bin/env node
/**
 * Subgraph-scoped health gate runner.
 *
 * Status: Phase 0 stub. The measure registry is intentionally empty — the
 * three parallel measure agents (BEHAVIORAL / STRUCTURAL / SHAPE) will
 * populate it next, then this runner is wired into pre-commit in Phase 2.4.
 *
 * Until those agents land, invoking this runner is harmless: it parses
 * the input, builds the subgraph, finds no measures to run, prints a
 * "no measures registered" notice, and exits 0.
 *
 * I/O lives here (the runner edge); the contract types and the extractor
 * are pure functions of their inputs.
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
 *   0   all measures pass (or registry empty)
 *   1   one or more violations at severity='fail'
 *   2   bad CLI usage
 */
import {execFileSync} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {DEFAULT_REPO_ROOT} from '../_shared/discovery/discover-packages.ts'
import {parseSubgraph} from '../_shared/graph/parse-subgraph.ts'
import {listMeasures} from '../_shared/measures/registry.ts'
import {loadBaseline} from '../_shared/measures/baseline-store.ts'
import type {SubgraphMeasureResult, Violation} from '../_shared/measures/subgraph-measure.ts'

type Args = {
    readonly changedFilesFrom: string | null
    readonly hops: number
    readonly depth: number
    readonly includeInbound: boolean
    readonly baselineRefresh: boolean
}

function parseArgs(argv: readonly string[]): Args {
    let changedFilesFrom: string | null = null
    let hops = 1
    let depth = 1
    let includeInbound = false
    let baselineRefresh = false
    for (const arg of argv) {
        if (arg === '--include-inbound') { includeInbound = true; continue }
        if (arg === '--baseline-refresh') { baselineRefresh = true; continue }
        const eq = arg.indexOf('=')
        if (eq < 0) {
            console.error(`subgraph-gate: unknown flag '${arg}'`)
            process.exit(2)
        }
        const key = arg.slice(2, eq)
        const value = arg.slice(eq + 1)
        if (key === 'changed-files-from') changedFilesFrom = value
        else if (key === 'hops') hops = parseInt(value, 10)
        else if (key === 'depth') depth = parseInt(value, 10)
        else { console.error(`subgraph-gate: unknown flag --${key}`); process.exit(2) }
    }
    if (!Number.isFinite(hops) || hops < 0) { console.error('subgraph-gate: --hops must be a non-negative integer'); process.exit(2) }
    if (!Number.isFinite(depth) || depth < 0) { console.error('subgraph-gate: --depth must be a non-negative integer'); process.exit(2) }
    return {changedFilesFrom, hops, depth, includeInbound, baselineRefresh}
}

async function loadChangedFiles(args: Args): Promise<string[]> {
    if (args.changedFilesFrom !== null) {
        const text = await readFile(args.changedFilesFrom, 'utf8')
        return text.split('\n').map(s => s.trim()).filter(s => s.length > 0)
    }
    // Default: derive from staged diff.
    const raw = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
        cwd: DEFAULT_REPO_ROOT,
        encoding: 'utf8',
    })
    return raw.split('\n').map(s => s.trim()).filter(s => s.length > 0)
}

async function decorateWithBaselines(
    result: SubgraphMeasureResult,
): Promise<SubgraphMeasureResult> {
    if (result.violations.length === 0) return result
    const baseline = await loadBaseline(result.measureId)
    const decorated: Violation[] = result.violations.map(v => ({
        ...v,
        baseline: v.baseline ?? (v.community in baseline ? baseline[v.community] : null),
    }))
    return {...result, violations: decorated}
}

function printViolationGroup(axis: string, byMeasureId: ReadonlyMap<string, readonly Violation[]>): void {
    const hasAny = [...byMeasureId.values()].some(vs => vs.length > 0)
    if (!hasAny) return
    process.stderr.write(`\n== ${axis} ==\n`)
    for (const [measureId, violations] of byMeasureId) {
        if (violations.length === 0) continue
        process.stderr.write(`  ${measureId}:\n`)
        for (const v of violations) {
            const base = v.baseline === null ? '(no baseline)' : `baseline=${v.baseline}`
            process.stderr.write(`    [${v.severity}] ${v.community}  score=${v.score}  ${base}  — ${v.message}\n`)
        }
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2))

    if (args.baselineRefresh) {
        // TODO (tasks.md Phase 0.4): wire to full-graph runner. Until then,
        // this flag does nothing — explicit refusal beats silent no-op.
        console.error('subgraph-gate: --baseline-refresh is not yet wired (Phase 0.4 pending).')
        process.exit(2)
    }

    const changedFiles = await loadChangedFiles(args)
    if (changedFiles.length === 0) {
        console.error('subgraph-gate: no changed files — nothing to check.')
        process.exit(0)
    }

    const measures = listMeasures()
    if (measures.length === 0) {
        console.error('subgraph-gate: no measures registered — nothing to check.')
        console.error('  (this is expected during Phase 0 — the three parallel measure agents will populate the registry.)')
        process.exit(0)
    }

    const needsInbound = args.includeInbound || measures.some(m => m.needsInbound)
    const parsedSubgraph = await parseSubgraph(changedFiles.map(p => resolve(DEFAULT_REPO_ROOT, p)), {
        hops: args.hops,
        includeInbound: needsInbound,
        depth: args.depth,
    })

    if (parsedSubgraph.touchedCommunities.length === 0) {
        console.error('subgraph-gate: changed files did not map to any package community — nothing to check.')
        process.exit(0)
    }

    const allResults: SubgraphMeasureResult[] = []
    for (const measure of measures) {
        const raw = await measure.run({changedFiles, parsedSubgraph})
        allResults.push(await decorateWithBaselines(raw))
    }

    const byAxis = new Map<string, Map<string, Violation[]>>()
    for (const measure of measures) {
        if (!byAxis.has(measure.axis)) byAxis.set(measure.axis, new Map())
    }
    for (const result of allResults) {
        const measure = measures.find(m => m.id === result.measureId)!
        const axisMap = byAxis.get(measure.axis)!
        axisMap.set(result.measureId, [...result.violations])
    }
    for (const [axis, byMeasureId] of byAxis) printViolationGroup(axis, byMeasureId)

    const failCount = allResults.reduce((n, r) => n + r.violations.filter(v => v.severity === 'fail').length, 0)
    process.exit(failCount > 0 ? 1 : 0)
}

main().catch(err => {
    console.error('subgraph-gate: fatal error')
    console.error(err)
    process.exit(1)
})
