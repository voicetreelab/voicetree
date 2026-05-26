// Public facade for the subgraph-gate package. The runner edge
// (`packages/measures/src/_runners/subgraph-gate.ts`) imports its
// orchestration symbols from here; the side-effect import below loads
// every concrete measure into the registry. Keep the surface minimal —
// `capture-subgraph-baselines.ts` reaches into `_internal/` directly
// because it needs additional symbols, and that intra-subdir edge is
// intentional.

import './_internal/load-all.ts'

export {listMeasures} from './_internal/registry.ts'
export {loadBaseline} from './_internal/baseline-store.ts'
export type {SubgraphMeasureResult, Violation} from './_internal/subgraph-measure.ts'
