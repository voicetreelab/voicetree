/**
 * Severity ranking for duplicate pairs.
 *
 *   severity = min(loc_A, loc_B) × similarity × log2(2 + import_distance)
 *
 * This converts a pair score into a "how concerning is this dup?" number
 * the human can act on:
 *   - mass         : larger duplicated functions are bigger refactor wins
 *   - similarity   : the existing pair score, in [0, 1]
 *   - log distance : same-file siblings get weight 1.0, cross-package /
 *                    unreachable dups get weight ~3.3 — graceful upweight
 *                    of cross-tier duplication without dominating mass
 *
 * Generic in the pair source: both the per-function and the workflow
 * checks feed in via `RankablePair`, and the ranker doesn't care which
 * was which (a `source` tag rides along for the output formatter only).
 *
 * LOC is measured as the whole function declaration span (end-line minus
 * start-line + 1) — body-only would under-count multi-line type signatures
 * and decorators. We rely on the AST node's positions, so it is
 * trivia-aware (no string counting).
 */
import * as ts from 'typescript'
import type {FunctionRecord} from '../duplication-extract/extract-functions.ts'

export type PairSource = 'function' | 'workflow'

export type RankablePair = {
    /** Canonical id for endpoint A — matches FunctionRecord.id. */
    readonly aId: string
    readonly bId: string
    readonly similarity: number
    readonly source: PairSource
    /** Carry along whatever per-source detail the caller wants surfaced later. */
    readonly extra?: Readonly<Record<string, unknown>>
}

export type SeverityRankedPair = {
    readonly aId: string
    readonly bId: string
    readonly aEndpoint: PairEndpointWithLoc
    readonly bEndpoint: PairEndpointWithLoc
    readonly similarity: number
    readonly importDistance: number
    readonly minLoc: number
    readonly severity: number
    readonly source: PairSource
    readonly extra?: Readonly<Record<string, unknown>>
}

export type PairEndpointWithLoc = {
    readonly packageName: string
    readonly file: string
    readonly line: number
    readonly name: string
    readonly loc: number
}

export type ImportDistanceFn = (fromRelPath: string, toRelPath: string) => number

/**
 * Compute LOC for a function record using its AST node's start/end lines.
 * Covers the WHOLE declaration (modifiers, signature, body) — this is the
 * unit a refactor would actually delete or move.
 */
export function functionLoc(record: FunctionRecord): number {
    const node: ts.Node = record.node
    const sourceFile = record.sourceFile
    const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
    const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line
    return endLine - startLine + 1
}

function endpointOf(record: FunctionRecord, loc: number): PairEndpointWithLoc {
    return {
        packageName: record.packageName,
        file: record.file,
        line: record.line,
        name: record.name,
        loc,
    }
}

function severityScore(minLoc: number, similarity: number, importDistance: number): number {
    return minLoc * similarity * Math.log2(2 + importDistance)
}

export type RankSeverityOptions = {
    /** Tie-break sort order between pairs of equal severity. */
    readonly stableSortKey?: (pair: SeverityRankedPair) => string
}

/**
 * Pure: given raw pairs, the index of FunctionRecords they reference, and
 * an import-distance function, return all pairs sorted by severity descending.
 *
 * Pairs whose endpoints cannot be resolved in `recordsById` are dropped
 * (no defensible severity to assign). This SHOULD never happen in normal
 * flow — both checks emit ids derived from the same FunctionRecord list —
 * but it is the safe behaviour if anyone ever feeds in stale data.
 */
export function rankSeverity(
    pairs: readonly RankablePair[],
    recordsById: ReadonlyMap<string, FunctionRecord>,
    importDistance: ImportDistanceFn,
    options: RankSeverityOptions = {},
): SeverityRankedPair[] {
    const locCache = new Map<string, number>()
    function locFor(record: FunctionRecord): number {
        const cached = locCache.get(record.id)
        if (cached !== undefined) return cached
        const loc = functionLoc(record)
        locCache.set(record.id, loc)
        return loc
    }

    const ranked: SeverityRankedPair[] = []
    for (const pair of pairs) {
        const aRecord = recordsById.get(pair.aId)
        const bRecord = recordsById.get(pair.bId)
        if (!aRecord || !bRecord) continue

        const locA = locFor(aRecord)
        const locB = locFor(bRecord)
        const minLoc = Math.min(locA, locB)
        const dist = importDistance(aRecord.file, bRecord.file)
        const severity = severityScore(minLoc, pair.similarity, dist)

        ranked.push({
            aId: pair.aId,
            bId: pair.bId,
            aEndpoint: endpointOf(aRecord, locA),
            bEndpoint: endpointOf(bRecord, locB),
            similarity: pair.similarity,
            importDistance: dist,
            minLoc,
            severity,
            source: pair.source,
            extra: pair.extra,
        })
    }

    const tieBreak = options.stableSortKey ?? defaultStableSortKey
    ranked.sort((a, b) => b.severity - a.severity || tieBreak(a).localeCompare(tieBreak(b)))
    return ranked
}

function defaultStableSortKey(pair: SeverityRankedPair): string {
    // (aId, bId) is canonical because both checks emit sorted pair ids.
    return `${pair.aId}|${pair.bId}`
}

/**
 * Histogram of severity values across `pairs`, bucketed at fixed widths
 * from 0 upward. Useful for picking a SEVERITY_THRESHOLD: read the
 * histogram, find the "knee", set threshold there.
 *
 * `bucketWidth` is in severity units (same scale as the formula). Each
 * pair lands in `floor(severity / bucketWidth)`. The returned array is
 * dense from bucket 0 to the bucket holding the maximum-severity pair.
 */
export function severityHistogram(
    pairs: readonly SeverityRankedPair[],
    bucketWidth: number,
): readonly {lower: number; upper: number; count: number}[] {
    if (bucketWidth <= 0) throw new Error('bucketWidth must be positive')
    if (pairs.length === 0) return []
    const maxSeverity = pairs.reduce((max, pair) => Math.max(max, pair.severity), 0)
    const bucketCount = Math.max(1, Math.floor(maxSeverity / bucketWidth) + 1)
    const counts = new Array(bucketCount).fill(0)
    for (const pair of pairs) {
        const bucket = Math.min(bucketCount - 1, Math.floor(pair.severity / bucketWidth))
        counts[bucket] += 1
    }
    return counts.map((count, bucket) => ({
        lower: bucket * bucketWidth,
        upper: (bucket + 1) * bucketWidth,
        count,
    }))
}
