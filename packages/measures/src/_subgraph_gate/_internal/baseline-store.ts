/**
 * On-disk baseline storage for subgraph-scoped health measures.
 *
 * Layout: one JSON per measure under `packages/measures/budgets/subgraph/`.
 * Filename = `<measure-id>.json`. Shape:
 *
 *   {
 *     "schemaVersion": 1,
 *     "refreshedAt": "2026-05-24T00:00:00.000Z",
 *     "byCommunity": {
 *       "graph-db-server/state": 27,
 *       "graph-tools/commands":   255,
 *       ...
 *     }
 *   }
 *
 * Refresh policy: written by the full-graph pre-push runner after every
 * green run (Phase 0.4 — not wired yet). Never hand-edit in normal flow;
 * a hand edit will be silently overwritten by the next pre-push run.
 *
 * Missing-baseline policy: {@link loadBaseline} returns an empty record
 * if the file does not exist. The gate decides per-measure whether a
 * missing baseline for a touched community is a fail (strict mode) or a
 * warn (introductory mode) — see SubgraphMeasure.run() implementations.
 *
 * Schema versioning: bumping `schemaVersion` is reserved for breaking
 * changes to the byCommunity shape (e.g. moving from scalar scores to
 * `{score, samples}` records). The loader currently rejects mismatches
 * loudly — better to fail than to silently treat new-shape data as old.
 */
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const BASELINE_SCHEMA_VERSION = 1

const THIS_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
/** Resolved at module load: `packages/measures/budgets/subgraph/`. */
const BASELINE_DIR: string = resolve(THIS_FILE_DIR, '..', '..', '..', 'budgets', 'subgraph')

type BaselineFile = {
    readonly schemaVersion: typeof BASELINE_SCHEMA_VERSION
    readonly refreshedAt: string
    readonly byCommunity: Readonly<Record<string, number>>
}

function baselinePath(measureId: string): string {
    if (!/^[a-z0-9_-]+$/i.test(measureId)) {
        throw new Error(`Invalid measureId for baseline filename: ${measureId}`)
    }
    return join(BASELINE_DIR, `${measureId}.json`)
}

/**
 * Read the persisted per-community baselines for `measureId`.
 *
 * Returns `{}` (empty record) if the baseline file does not yet exist —
 * which is the normal state for a measure that has never run the
 * baseline-refresh path yet. Callers MUST handle missing entries (per
 * community) explicitly.
 *
 * Throws on schema-version mismatch or malformed JSON — those are
 * upstream bugs, not normal misses.
 */
export async function loadBaseline(measureId: string): Promise<Readonly<Record<string, number>>> {
    const path = baselinePath(measureId)
    let raw: string
    try {
        raw = await readFile(path, 'utf8')
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
        throw err
    }
    const parsed = JSON.parse(raw) as Partial<BaselineFile>
    if (parsed.schemaVersion !== BASELINE_SCHEMA_VERSION) {
        throw new Error(
            `Baseline schema mismatch for ${measureId}: file is v${parsed.schemaVersion}, code expects v${BASELINE_SCHEMA_VERSION}`,
        )
    }
    if (!parsed.byCommunity || typeof parsed.byCommunity !== 'object') {
        throw new Error(`Baseline file for ${measureId} is missing 'byCommunity' map`)
    }
    return parsed.byCommunity
}

/**
 * Atomically replace the on-disk baseline for `measureId` with the given
 * per-community scores.
 *
 * Wired into the full-graph pre-push run (Phase 0.4) — the subgraph gate
 * itself never writes baselines. Calling this from the subgraph gate
 * would defeat the purpose: it would treat each commit's score as the
 * new ground truth and never detect regressions.
 */
export async function writeBaseline(
    measureId: string,
    byCommunity: Readonly<Record<string, number>>,
): Promise<void> {
    const path = baselinePath(measureId)
    await mkdir(dirname(path), {recursive: true})
    const payload: BaselineFile = {
        schemaVersion: BASELINE_SCHEMA_VERSION,
        refreshedAt: new Date().toISOString(),
        byCommunity: {...byCommunity},
    }
    await writeFile(path, JSON.stringify(payload, null, 2) + '\n', 'utf8')
}
