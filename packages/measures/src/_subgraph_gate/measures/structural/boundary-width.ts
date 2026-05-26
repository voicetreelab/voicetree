/**
 * Boundary width per community: total exported symbols summed across all
 * files in the community. The Shannon channel capacity / interface-width
 * analog — narrow public surface forces callers through a contract; a
 * 47-symbol surface lets callers couple to anything.
 *
 * Fix patterns:
 *   - P2 (package-as-deep-function): public exports collapse to one entry
 *     point that hides internal structure.
 *   - M1 (deep-narrow modules): each module exports ONE function; helpers
 *     stay private.
 *   - Pattern 1 (core/shell): pull non-port exports out of the core; they
 *     belong in the shell, which can have its own — separately measured —
 *     boundary width.
 *
 * Scoring:
 *   perCommunity[c] = sum over files in c of exportedSymbolNames(file).length
 *
 * Thresholds:
 *   - Absolute fail-safe: > {@link BOUNDARY_WIDTH_ABSOLUTE_BUDGET} symbols
 *     in a single community. Calibrated from exports-per-file.test.ts's
 *     MAX_BUDGET of 121 per file — at three files per community that's
 *     already over-budget, so 30 is a generous community-level cap.
 *   - Baseline-delta: any regression above baseline fails.
 *
 * needsInbound = false:
 *   Score only counts the exports the community itself emits. External
 *   importers don't affect it.
 *
 * needsTsMorph = false:
 *   We use ts.createSourceFile directly via the shared exportedSymbolNames
 *   helper — order of magnitude cheaper than spinning up ts-morph's Project.
 */
import {readFile} from 'node:fs/promises'
import {exportedSymbolNames} from '../../../_shared/complexity/exported-symbols.ts'
import type {SourceFile} from '../../../_shared/graph/import-graph.ts'
import {loadBaseline} from '../../_internal/baseline-store.ts'
import {registerMeasure} from '../../_internal/registry.ts'

const SKILL_DOC = 'brain/workflows/engineering/architectural-complexity/fp-rearchitecting/address_measures/address-boundary-width.md'
import type {
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../_internal/subgraph-measure.ts'

export const MEASURE_ID = 'boundary-width'

/**
 * Communities exporting more than this many symbols are auto-fail.
 * Calibrate down as we ratchet; 30 is a "deeply unhealthy" floor.
 */
export const BOUNDARY_WIDTH_ABSOLUTE_BUDGET = 30

function boundaryExportNames(filePath: string, text: string): readonly string[] {
    const names = exportedSymbolNames(filePath, text)
    if (!filePath.includes('/packages/measures/src/checks/')) return names

    // Check modules are auto-discovered plugin adapters. Their uniform port
    // exports are framework hooks, not a hand-authored public API surface.
    return names.filter(name => name !== 'check' && name !== 'checkFile')
}

async function countExportsInFile(file: SourceFile, parsedSubgraph: SubgraphMeasureInput['parsedSubgraph']): Promise<number> {
    // Prefer parsedSubgraph's cached content — it routes through the
    // runner's staged-blob loader so unstaged peer-WIP doesn't pollute
    // this commit's score. Fall back to disk only when the subgraph was
    // built by an out-of-band path (test helpers) that didn't populate
    // the cache.
    const cached = parsedSubgraph.getContent(file.absolutePath)
    if (cached !== null) return boundaryExportNames(file.absolutePath, cached).length
    try {
        const text = await readFile(file.absolutePath, 'utf8')
        return boundaryExportNames(file.absolutePath, text).length
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0
        throw err
    }
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const touched = new Set(parsedSubgraph.touchedCommunities)

    const filesByCommunity = new Map<string, SourceFile[]>()
    for (const f of parsedSubgraph.files) {
        const c = parsedSubgraph.communityMap.get(f.absolutePath)
        if (!c || !touched.has(c)) continue
        if (!filesByCommunity.has(c)) filesByCommunity.set(c, [])
        filesByCommunity.get(c)!.push(f)
    }

    const perCommunity: Record<string, number> = {}
    for (const community of parsedSubgraph.touchedCommunities) {
        const files = filesByCommunity.get(community) ?? []
        const counts = await Promise.all(files.map(f => countExportsInFile(f, parsedSubgraph)))
        perCommunity[community] = counts.reduce((s, n) => s + n, 0)
    }

    const baseline = await loadBaseline(MEASURE_ID)
    const violations: Violation[] = []
    for (const community of parsedSubgraph.touchedCommunities) {
        const current = perCommunity[community]
        const baselineScore = community in baseline ? baseline[community] : null
        if (current > BOUNDARY_WIDTH_ABSOLUTE_BUDGET) {
            violations.push({
                community,
                score: current,
                baseline: baselineScore,
                severity: 'fail',
                message: `boundary-width ${current} exports > absolute budget ${BOUNDARY_WIDTH_ABSOLUTE_BUDGET} — community has a wide public channel; collapse to a deep-function shape`
                    + `\nSee: ${SKILL_DOC}`,
            })
            continue
        }
        if (baselineScore !== null && current > baselineScore) {
            violations.push({
                community,
                score: current,
                baseline: baselineScore,
                severity: 'fail',
                message: `boundary-width regressed: ${baselineScore} -> ${current} exports`
                    + `\nSee: ${SKILL_DOC}`,
            })
        }
    }
    return {measureId: MEASURE_ID, perCommunity, violations}
}

export const boundaryWidthMeasure: SubgraphMeasure = {
    id: MEASURE_ID,
    axis: 'structural',
    scope: 'community',
    needsTsMorph: false,
    needsInbound: false,
    run,
}

registerMeasure(boundaryWidthMeasure)
