/**
 * In-process registry of {@link SubgraphMeasure}s wired into the gate.
 *
 * Initially empty. Each measure module (structural-orange, behavioral-orange,
 * shape-orange, …) calls {@link registerMeasure} at import time to add
 * itself; the gate runner imports the module to trigger that side effect,
 * then iterates {@link listMeasures}.
 *
 * Duplicate registration of the same `id` throws — the gate must not
 * silently shadow an earlier measure with a later one.
 */
import type {SubgraphMeasure} from './subgraph-measure.ts'

const measuresById = new Map<string, SubgraphMeasure>()

export function registerMeasure(measure: SubgraphMeasure): void {
    if (measuresById.has(measure.id)) {
        throw new Error(`SubgraphMeasure id '${measure.id}' already registered`)
    }
    measuresById.set(measure.id, measure)
}

export function listMeasures(): readonly SubgraphMeasure[] {
    return [...measuresById.values()]
}

/**
 * Test-only: clear the registry. Production runners must NEVER call this —
 * the registry is process-global and clearing it mid-run loses every
 * measure the import side-effects have added.
 */
export function __resetRegistryForTesting(): void {
    measuresById.clear()
}
