/**
 * Real-repo sanity check.
 *
 * Runs the seven structural measures against four known communities.
 * Marked `it.skip` by default — this is a calibration probe, not a CI
 * gate. Un-skip locally to see numbers.
 *
 * Captured 2026-05-24 (dev-manu @ 3bfaac00):
 *
 *   graph-db-server/state   (had dual-state bug — expect bad numbers):
 *     structural-orange=18  tw=1  Q=-0.337  dsm-back=2  cycles=1
 *     boundary=55           martin-D=0.65 (fail-zone) ✓
 *     → matches intuition: a touched-and-broken community, the partition
 *       is in the negative-Q zone and there's a real cycle.
 *
 *   graph-model/__root__    (top-level types-ish files):
 *     structural-orange=67  tw=0  Q=-0.5    dsm-back=0  cycles=0
 *     boundary=235          martin-D=0.82
 *     → high boundary (graph-model exports lots of types). High structural-
 *       orange because __root__ imports heavily from sibling pure/.
 *       Negative Q because root↔pure cross-edges dwarf intra-community
 *       edges — partition is fiction at depth 1.
 *
 *   graph-model/pure        (pure-FP submodule):
 *     structural-orange=0   tw=6  Q=-0.04   dsm-back=0  cycles=2
 *     boundary=461          martin-D=0.74 (fail-zone)
 *     → tw=6 is OVER the 5 budget; cycles=2 surprise inside "pure";
 *       boundary=461 confirms the deep-narrow ideal isn't being met.
 *       High martin-D because most "pure" decls are concrete `const fn =`
 *       not type aliases — measure correctly flags that.
 *
 *   webapp/shell            (effectful shell):
 *     structural-orange=0   tw=3  Q=1      dsm-back=0  cycles=1
 *     boundary=1027         martin-D=0.17 (healthy)
 *     → low D matches the shell-pattern intuition (concrete + high
 *       outbound Ce). Q=1 from single-community parent fallback.
 *       boundary=1027 is enormous — webapp/shell is far too wide;
 *       expected.
 */
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages} from '../../../_shared/discovery/discover-packages.ts'
import {parseSubgraph} from '../../../_shared/graph/parse-subgraph.ts'
import {scanSourceFiles} from '../../../_shared/graph/import-graph.ts'
import {communityForFile} from '../../../_shared/community/community-at-depth.ts'
import {boundaryWidthMeasure} from './boundary-width.ts'
import {cyclesMeasure} from './cycles.ts'
import {dsmUpperTriangularMeasure} from './dsm-upper-triangular.ts'
import {martinDistanceMeasure} from './martin-distance.ts'
import {modularityQMeasure} from './modularity-q.ts'
import {structuralOrangeMeasure} from './structural-orange.ts'
import {treeWidthApproxMeasure} from './tree-width-approx.ts'
import type {SubgraphMeasure} from '../../../_shared/measures/subgraph-measure.ts'

const ALL_MEASURES: SubgraphMeasure[] = [
    structuralOrangeMeasure,
    treeWidthApproxMeasure,
    modularityQMeasure,
    dsmUpperTriangularMeasure,
    cyclesMeasure,
    boundaryWidthMeasure,
    martinDistanceMeasure,
]

async function communityFilesByName(targetCommunity: string): Promise<string[]> {
    const packages = await discoverPackages()
    const files = await scanSourceFiles(packages)
    return files.filter(f => communityForFile(f, 1) === targetCommunity).map(f => f.absolutePath)
}

async function runAll(changedFiles: string[]): Promise<Record<string, Record<string, number>>> {
    if (changedFiles.length === 0) return {}
    const parsedSubgraph = await parseSubgraph(changedFiles, {
        repoRoot: DEFAULT_REPO_ROOT,
        depth: 1,
        includeInbound: true,
    })
    const out: Record<string, Record<string, number>> = {}
    for (const measure of ALL_MEASURES) {
        const result = await measure.run({changedFiles, parsedSubgraph})
        out[measure.id] = result.perCommunity
    }
    return out
}

function dump(name: string, scores: Record<string, Record<string, number>>): void {
    console.info(`\n=== ${name} ===`)
    for (const [measureId, perCommunity] of Object.entries(scores)) {
        for (const [community, score] of Object.entries(perCommunity)) {
            console.info(`  ${measureId.padEnd(24)} ${community.padEnd(48)} ${score}`)
        }
    }
}

describe('real-repo sanity check (calibration probe)', () => {
    it.skip('reports numbers for three known communities', async () => {
        const stateFiles = await communityFilesByName('graph-db-server/state')
        const modelFiles = await communityFilesByName('graph-model/__root__')
        const modelPureFiles = await communityFilesByName('graph-model/pure')
        const shellFiles = await communityFilesByName('webapp/shell')

        const stateScores = await runAll(stateFiles)
        const modelScores = await runAll(modelFiles)
        const modelPureScores = await runAll(modelPureFiles)
        const shellScores = await runAll(shellFiles)

        dump('graph-db-server/state', stateScores)
        dump('graph-model/__root__', modelScores)
        dump('graph-model/pure', modelPureScores)
        dump('webapp/shell', shellScores)

        // Don't ratchet — this just smoke-tests that the run path works
        // end-to-end on real input. Skipped by default; un-skip locally.
        expect(true).toBe(true)
    }, 60_000)
})
