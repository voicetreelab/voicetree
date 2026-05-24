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
 *   node --experimental-strip-types packages/measures/src/_runners/capture-subgraph-baselines.ts
 */
import {DEFAULT_REPO_ROOT, discoverPackages} from '../_shared/discovery/discover-packages.ts'
import {scanSourceFiles} from '../_shared/graph/import-graph.ts'
import {parseSubgraph} from '../_shared/graph/parse-subgraph.ts'
import {listMeasures} from '../_shared/measures/registry.ts'
import {writeBaseline} from '../_shared/measures/baseline-store.ts'
import '../_shared/measures/load-all.ts'

async function main(): Promise<void> {
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
}

main().catch(err => {
    console.error('capture-subgraph-baselines: fatal error')
    console.error(err)
    process.exit(1)
})
