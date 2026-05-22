import { applyPositions as applyPositionsImpl } from './layout/applyPositions'
import type { Graph } from '..'

// === POSITIONING ===

export type ApplyPositions = (graph: Graph) => Graph
export const applyPositions: ApplyPositions = applyPositionsImpl

export { rebaseNewClusterPositions } from './layout/rebaseNewClusterPositions'
