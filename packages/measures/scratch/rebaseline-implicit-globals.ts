#!/usr/bin/env node
/**
 * Focused re-baseline for implicit-globals only.
 *
 * Use after changing implicit-globals scoring semantics (tier split:
 * 2026-05-26). The shared capture-subgraph-baselines.ts rebaselines ALL
 * measures in one shot, which would overwrite peer-agent work in flight
 * on other baselines. This script touches only the one file we changed.
 *
 *   node --experimental-strip-types packages/measures/scratch/rebaseline-implicit-globals.ts
 */
import {DEFAULT_REPO_ROOT, discoverPackages} from '../src/_shared/discovery/discover-packages.ts'
import {scanSourceFiles} from '../src/_shared/graph/import-graph.ts'
import {parseSubgraph} from '../src/_shared/graph/parse-subgraph.ts'
import {writeBaseline} from '../src/_subgraph_gate/_internal/baseline-store.ts'
import {measure as implicitGlobalsMeasure} from '../src/_subgraph_gate/measures/behavioral/implicit-globals.ts'

async function main(): Promise<void> {
    const packages = await discoverPackages(DEFAULT_REPO_ROOT)
    const allFiles = await scanSourceFiles(packages, DEFAULT_REPO_ROOT)
    const allPaths = allFiles.map(f => f.absolutePath)
    console.log(`Discovered ${allPaths.length} TS files across ${packages.length} packages`)

    const parsedSubgraph = await parseSubgraph(allPaths, {hops: 0, includeInbound: true, depth: 1})
    console.log(
        `Subgraph: ${parsedSubgraph.files.length} files, ${parsedSubgraph.edges.length} edges, ` +
        `${parsedSubgraph.touchedCommunities.length} communities`,
    )

    const start = Date.now()
    const result = await implicitGlobalsMeasure.run({changedFiles: allPaths, parsedSubgraph})
    const ms = Date.now() - start

    await writeBaseline(implicitGlobalsMeasure.id, result.perCommunity)
    const n = Object.keys(result.perCommunity).length
    console.log(`implicit-globals rebaselined: ${n} communities, ${ms}ms`)

    const sorted = Object.entries(result.perCommunity).sort(([, a], [, b]) => b - a)
    console.log('\nTop 10 communities by strict-tier score:')
    for (const [c, s] of sorted.slice(0, 10)) console.log(`  ${s.toString().padStart(5)}  ${c}`)
}

main().catch(err => {
    console.error('rebaseline-implicit-globals: fatal error')
    console.error(err)
    process.exit(1)
})
