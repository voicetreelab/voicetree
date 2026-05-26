/**
 * Public API for the subgraph-gate engine. Importing this file:
 *
 *   1. Triggers `load-all.ts`'s side-effect imports so the registry is
 *      populated before any caller calls `listMeasures()`.
 *   2. Re-exports the five symbols runners need to drive the gate end-to-end:
 *      `listMeasures`, `loadBaseline`, `writeBaseline` plus the two public
 *      result types runners format and exit on.
 *
 * Runners must consume from here, not from `./_internal/*`. The `_internal`
 * marker is honest only if leaf modules below it stay private to the
 * package — otherwise the cross-package import graph shows callers reaching
 * into internals that should be free to refactor.
 */
import './_internal/load-all.ts'

export {listMeasures} from './_internal/registry.ts'
export {loadBaseline, writeBaseline} from './_internal/baseline-store.ts'
export type {SubgraphMeasureResult, Violation} from './_internal/subgraph-measure.ts'
