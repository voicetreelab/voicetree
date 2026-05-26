#!/usr/bin/env node
/**
 * Bootstrap baseline-capture for the subgraph-scoped health gate.
 *
 * Runs every registered SubgraphMeasure at FULL-GRAPH scope (changedFiles
 * = every TS file in the repo) and writes the per-community result to
 * packages/measures/budgets/subgraph/<measure-id>.json.
 *
 * Use cases:
 *   - One-shot bootstrap so the gate has a baseline on day one
 *     (without it, every commit fails on inherited debt — the gate is
 *     "brutal" mode).
 *   - Manual refresh: rerun after a green pre-push to snapshot the new
 *     ground truth. The eventual Phase 0.4 work automates this on the
 *     pre-push hook.
 *
 * Cost: roughly minutes — every measure runs over every community at
 * once. Acceptable for an occasional refresh; not for per-commit use.
 *
 * Usage:
 *   node --experimental-strip-types packages/measures/scripts/capture-subgraph-baselines.ts
 */
import {execFileSync} from 'node:child_process'
import {appendFile} from 'node:fs/promises'
import {join} from 'node:path'

import {baselinePolicy} from '../src/_shared/policy/baseline-policy.ts'
import {DEFAULT_REPO_ROOT, discoverPackages} from '../src/_shared/discovery/discover-packages.ts'
import {scanSourceFiles} from '../src/_shared/graph/import-graph.ts'
import {parseSubgraph} from '../src/_shared/graph/parse-subgraph.ts'
import {listMeasures, writeBaseline} from '../src/_subgraph_gate/index.ts'

const BUMP_LOG_PATH = join(DEFAULT_REPO_ROOT, 'packages', 'measures', 'budgets', 'BASELINE_BUMP_LOG.md')

type Args = {readonly iAmSure: boolean; readonly reason: string | null}

function parseArgs(argv: readonly string[]): Args {
    let iAmSure = false
    let reason: string | null = null
    for (const arg of argv) {
        if (arg === '--i-am-sure') { iAmSure = true; continue }
        if (arg.startsWith('--reason=')) { reason = arg.slice('--reason='.length); continue }
        console.error(`capture-subgraph-baselines: unknown flag '${arg}'`)
        process.exit(2)
    }
    return {iAmSure, reason}
}

function refusalBanner(): string {
    return [
        '',
        '━'.repeat(80),
        'Refused: this runner refreshes baselines, which is almost never the right',
        'response to a failing subgraph-gate. The gate failed because your commit',
        'worsened a community\'s score; the fix is to refactor the change, not',
        'raise the threshold.',
        '',
        'If — after applying the FP rearchitecting pattern — you have concluded',
        'a refresh is genuinely justified, rerun with explicit consent:',
        '',
        `  npm run measures:capture-baselines -- --i-am-sure --reason="<>=${baselinePolicy.minRationaleChars} chars>"`,
        '',
        'The reason will be appended to packages/measures/budgets/BASELINE_BUMP_LOG.md',
        'so git history records why the refresh was authorized.',
        '━'.repeat(80),
        '',
    ].join('\n')
}

function gitUser(): string {
    try {
        const name = execFileSync('git', ['config', 'user.name'], {cwd: DEFAULT_REPO_ROOT, encoding: 'utf8'}).trim()
        const email = execFileSync('git', ['config', 'user.email'], {cwd: DEFAULT_REPO_ROOT, encoding: 'utf8'}).trim()
        return `${name} <${email}>`
    } catch {
        return 'unknown'
    }
}

async function appendBumpLogEntry(reason: string): Promise<void> {
    const line = `- ${new Date().toISOString()} · ${gitUser()} · ${reason}\n`
    await appendFile(BUMP_LOG_PATH, line, 'utf8')
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2))
    if (!args.iAmSure || args.reason === null || args.reason.length < baselinePolicy.minRationaleChars) {
        process.stderr.write(refusalBanner())
        process.exit(1)
    }

    const packages = await discoverPackages(DEFAULT_REPO_ROOT)
    const allFiles = await scanSourceFiles(packages, DEFAULT_REPO_ROOT)
    const allPaths = allFiles.map(f => f.absolutePath)

    console.log(`Discovered ${allPaths.length} TS files across ${packages.length} packages`)

    // hops=0 so no neighbor expansion is needed (every file is already touched).
    // includeInbound=true so measures that need symmetric coupling see the full edge set.
    const parsedSubgraph = await parseSubgraph(allPaths, {
        hops: 0,
        includeInbound: true,
        depth: 1,
    })

    console.log(
        `Subgraph: ${parsedSubgraph.files.length} files, ${parsedSubgraph.edges.length} edges, ` +
        `${parsedSubgraph.touchedCommunities.length} communities`,
    )

    const measures = listMeasures()
    console.log(`\nRunning ${measures.length} measures:`)

    for (const measure of measures) {
        const start = Date.now()
        process.stdout.write(`  [${measure.axis.padEnd(10)}] ${measure.id} ... `)
        try {
            const result = await measure.run({changedFiles: allPaths, parsedSubgraph})
            await writeBaseline(measure.id, result.perCommunity)
            const ms = Date.now() - start
            const n = Object.keys(result.perCommunity).length
            console.log(`${n} communities baselined (${ms}ms)`)
        } catch (err) {
            const ms = Date.now() - start
            console.log(`FAILED (${ms}ms): ${(err as Error).message}`)
            throw err
        }
    }

    console.log('\nBaselines written under packages/measures/budgets/subgraph/')
    await appendBumpLogEntry(args.reason!)
    console.log(`Bump logged in ${BUMP_LOG_PATH}`)
}

main().catch(err => {
    console.error('capture-subgraph-baselines: fatal error')
    console.error(err)
    process.exit(1)
})
