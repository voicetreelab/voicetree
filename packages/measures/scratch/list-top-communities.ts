/**
 * SPIKE helper — prints the top-N communities by priority score at depth=1,
 * along with one example file from each, so we can pick a realistic touched-file
 * input for the comparison runner.
 */
import {discoverPackages} from '../src/_shared/discovery/discover-packages.js'
import {buildImportGraph} from '../src/_shared/graph/import-graph.js'
import {communityAtDepth, siblingGroupParent} from './parse-subgraph.js'

const DEPTH = 1

async function main(): Promise<void> {
    const packages = await discoverPackages()
    const graph = await buildImportGraph(packages)
    const fileCommunities = new Map<string, string>()
    for (const f of graph.files) fileCommunities.set(f.absolutePath, communityAtDepth(f.packageName, f.relToSrc, DEPTH))

    const communitiesByParent = new Map<string, Set<string>>()
    for (const f of graph.files) {
        const c = fileCommunities.get(f.absolutePath)!
        const p = siblingGroupParent(c, DEPTH)
        if (!communitiesByParent.has(p)) communitiesByParent.set(p, new Set())
        communitiesByParent.get(p)!.add(c)
    }

    type Row = {community: string; parent: string; outEdges: number; fanOut: number; score: number; fileCount: number; exampleFile: string | null}
    const rows: Row[] = []
    for (const [parent, communitySet] of communitiesByParent) {
        if (communitySet.size < 2) continue
        const out = new Map<string, number>()
        const fan = new Map<string, Set<string>>()
        for (const c of communitySet) {out.set(c, 0); fan.set(c, new Set())}
        for (const e of graph.edges) {
            const fromC = fileCommunities.get(e.from.absolutePath)!
            const toC = fileCommunities.get(e.to.absolutePath)!
            if (siblingGroupParent(fromC, DEPTH) !== parent || siblingGroupParent(toC, DEPTH) !== parent) continue
            if (fromC === toC) continue
            out.set(fromC, (out.get(fromC) ?? 0) + 1)
            fan.get(fromC)!.add(toC)
        }
        for (const c of communitySet) {
            const o = out.get(c) ?? 0
            const f = fan.get(c)?.size ?? 0
            const filesInComm = graph.files.filter(file => fileCommunities.get(file.absolutePath) === c)
            rows.push({
                community: c,
                parent,
                outEdges: o,
                fanOut: f,
                score: o * Math.max(1, f),
                fileCount: filesInComm.length,
                exampleFile: filesInComm[0]?.relativePath ?? null,
            })
        }
    }
    rows.sort((a, b) => b.score - a.score)
    for (const r of rows.slice(0, 15)) {
        console.log(`score=${String(r.score).padStart(5)} outE=${String(r.outEdges).padStart(3)} fan=${String(r.fanOut).padStart(2)}  files=${String(r.fileCount).padStart(3)}  ${r.community}`)
        console.log(`                                                                example: ${r.exampleFile}`)
    }
}

main().catch(e => {console.error(e); process.exit(1)})
