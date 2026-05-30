/**
 * Uniform contract for any measure that participates in the subgraph
 * commit gate.
 *
 * Every measure exposes the same shape (`SubgraphMeasure`), so the gate
 * runner can iterate a registry without knowing which axis (behavioral,
 * structural, shape) each measure belongs to. The runner is responsible
 * for I/O (reading git diff, loading baselines, printing violations);
 * the measure body is a pure function from `{changedFiles, parsedSubgraph}`
 * to a {@link SubgraphMeasureResult}.
 *
 * Aggregation contract:
 *   - Measures reporting `scope: 'community'` MUST return one entry per
 *     touched community in `perCommunity`, even if the score is 0 (so the
 *     baseline-diff loop can detect "regressed from 0 to 1").
 *   - Measures reporting `scope: 'file'` aggregate file-level scores into
 *     per-community sums/maxes/averages (their choice) and still populate
 *     `perCommunity` — file-level results don't appear on the gate.
 *   - `scope: 'global'` measures should NOT be in the subgraph gate;
 *     they belong to the full-graph pre-push pass. Listed for symmetry
 *     with the existing CheckDef scope concept.
 */
import type {ParsedSubgraph} from '../../_shared/graph/parse-subgraph.ts'

export type Severity = 'pass' | 'warn' | 'fail'

export type Violation = {
    readonly community: string
    readonly score: number
    /**
     * High-water-mark budget the runner compared this score against — the
     * worst score across all communities in the last full-graph capture.
     * Stamped by the runner (measures emit `null`); null when nothing has
     * been captured for the measure yet.
     */
    readonly baseline: number | null
    readonly severity: Severity
    readonly message: string
}

export type SubgraphMeasureResult = {
    readonly measureId: string
    /** Score per community in the touched-community set. Always present. */
    readonly perCommunity: Readonly<Record<string, number>>
    /** Subset of `perCommunity` entries that exceed the measure's threshold. */
    readonly violations: readonly Violation[]
}

type MeasureAxis = 'behavioral' | 'structural' | 'shape'

type MeasureScope = 'file' | 'community' | 'global'

export type SubgraphMeasureInput = {
    /** Repo-relative or absolute paths of files changed in the staged diff. */
    readonly changedFiles: readonly string[]
    /** Pre-parsed subgraph shared across all measures in the gate run. */
    readonly parsedSubgraph: ParsedSubgraph
}

export type SubgraphMeasure = {
    /** Stable id, used as the baseline filename and dashboard key (e.g. `structural-orange`). */
    readonly id: string
    readonly axis: MeasureAxis
    readonly scope: MeasureScope
    /**
     * If true, the measure will call `parsedSubgraph.getProject()` —
     * the gate runner uses this to decide whether to pre-warm the
     * ts-morph project once for the batch or skip it entirely.
     */
    readonly needsTsMorph: boolean
    /**
     * If true, the measure requires inbound importer edges into the
     * touched-community files (e.g. fanIn, modularity Q, semantic coupling).
     * The gate runner unions every registered measure's needsInbound
     * and parses the subgraph once with `includeInbound` set accordingly.
     *
     * Structural-orange does NOT need inbound — its score is outbound-only.
     * Default-false is the right answer for any new measure unless you can
     * point at the formula and show inbound edges feed it.
     */
    readonly needsInbound: boolean
    run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult>
}
