import {readFile} from 'node:fs/promises'
import {describe, expect, it} from 'vitest'
import {clusterDuplicates} from '../../duplication-per-function/cluster-duplicates'
import {extractFunctions} from '../../duplication-extract/extract-functions'
import {formatDuplicateRows} from '../../duplication-per-function/format-duplicate-rows'
import {discoverPackages} from '../../_shared/discovery/discover-packages'
import {discoverSourceFiles} from '../../_shared/discovery/function-discovery'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

// Captured 2026-05-25 on first full-repo run: observed 534 pairs at or
// above the 0.7 score threshold across 4295 discovered functions; budget
// was 539 (observed + 5 headroom).
// Re-anchored 2026-05-26 after the call-DAG primitives landed under
// _shared/duplication/: the population grew to 4319 functions and the new
// modules added 15 sub-1.0 pairs (none in the top-20 — the strongest
// duplicates the new code carries are workflow-shaped and now caught by
// the workflow-duplication health test rather than the per-function one).
// Re-anchored at observed 549 + 5 headroom = 554.
// Re-anchored 2026-05-28 [PR #135 merge: dev-manu → dev]:
//   merging origin/dev's vt-daemon migration into dev-manu raised the
//   >=0.7-score pair count from 549 to 626 (+77). These are genuine
//   near-duplicates introduced by the vt-daemon split (forkAgentSession ↔
//   resumePersistedAgentSession, otlpReceiver ↔ bodyReader, agentEventsSse ↔
//   terminalRegistrySse, etc., already surfaced by the recoverable-LOC gate).
//   Re-anchored at observed 626 + 5 headroom = 631; ratchet DOWN as the
//   vt-daemon split is consolidated.
// Re-anchored 2026-05-28 [PR #135 vt-daemon merge-conflict fix follow-up]:
//   restoring the two getRuntime* wrappers in vt-daemon/agent-runtime/
//   runtime/graph-bridge.ts (dropped by the same merge that broke vtd
//   boot) added pairs matching the file's existing thin-wrapper pattern.
//   Observed 632 + 5 headroom = 637; ratchet DOWN as graph-bridge.ts is
//   restructured (the wrappers are intentionally minimal — each provides
//   a stable public name over the GraphStateBridge interface).
// Re-anchored 2026-05-28 [PR #139 cgcli addition]:
//   @vt/code-graph-cli's six command files (callers/callees/reachable/
//   imports/find-symbol/hotspots) share a thin JSON-emitting shape over
//   the call-graph primitives — same intentional thin-wrapper pattern as
//   graph-bridge.ts. Observed 640 + 5 headroom = 645; ratchet DOWN as
//   the command bodies grow past their current 1–2 call shape.
// Re-anchored 2026-06-01 [semantic dedup cleanup]:
//   8 genuine duplicate eliminations (pathExists, sortStrings×3, rectArea,
//   edge factory, makeNodeExtensionChecker, compareEdges×3, findRootNodeIds,
//   buildSearchRect delegation) reduced the population from 5173 to 5146 functions
//   and the >=0.7 pair count from 658 to 626.
//   Observed 626 + 5 headroom = 631; ratchet DOWN as remaining intentional
//   thin-wrapper clusters (subscribeX, isCallerKind/isDaemonKind) are consolidated.
// Ratchet DOWN as the codebase is de-duplicated, never up.
const MAX_DUPLICATE_PAIRS: number = 631

const SCORE_THRESHOLD: number = 0.7

describe('semantic function-duplication health', () => {
    it('keeps the count of >=0.7-score duplicate pairs within budget', async () => {
        const packages = await discoverPackages()
        const files = await discoverSourceFiles(packages)
        // Scope the AST-bearing records so they become unreachable once
        // clustering returns its (lean) DuplicatePair[] — full-repo ASTs are
        // multi-GB and the suite runs in a single vitest worker, so any
        // leftover reference here piles up across sibling health tests.
        const {recordCount, pairs} = await (async () => {
            const records = await extractFunctions(files, path => readFile(path, 'utf8'))
            // topK large enough to see the full distribution; details still
            // store only the top 20. The check report (current count) needs
            // the true number of pairs at-or-above the threshold, not a
            // truncated one.
            return {recordCount: records.length, pairs: clusterDuplicates(records, {topK: 100000})}
        })()

        const overThreshold = pairs.filter(pair => pair.score >= SCORE_THRESHOLD)
        const top20 = overThreshold.slice(0, 20)

        console.info(`\nTotal functions analysed: ${recordCount}`)
        console.info(`Pairs reported (>=2 signals): ${pairs.length}`)
        console.info(`Pairs at or above score ${SCORE_THRESHOLD}: ${overThreshold.length}\n`)
        console.info(`Top 20 semantic duplicate pairs:\n${formatDuplicateRows(top20)}`)

        await recordHealthMetric({
            metricId: 'semantic-duplicate-pairs',
            metricName: `Semantic Duplicate Pairs (>=${SCORE_THRESHOLD} score)`,
            description: 'Count of cross-file function pairs whose weighted Jaccard score across structural, lexical, and behavioural fingerprints is at or above the threshold.',
            category: 'Structure',
            current: overThreshold.length,
            budget: MAX_DUPLICATE_PAIRS,
            comparison: 'lte',
            unit: 'pairs',
            details: {
                totalFunctions: recordCount,
                fileCount: files.length,
                scoreThreshold: SCORE_THRESHOLD,
                topPairs: top20.map(pair => ({
                    packageA: pair.a.packageName,
                    fileA: pair.a.file,
                    lineA: pair.a.line,
                    nameA: pair.a.name,
                    packageB: pair.b.packageName,
                    fileB: pair.b.file,
                    lineB: pair.b.line,
                    nameB: pair.b.name,
                    score: Number(pair.score.toFixed(3)),
                    signalsMatched: pair.signalsMatched,
                })),
            },
        })

        expect.soft(overThreshold.length).toBeLessThanOrEqual(MAX_DUPLICATE_PAIRS)
    }, 120000)
})
