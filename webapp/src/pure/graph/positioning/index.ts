import { applyPositions as applyPositionsImpl } from './applyPositions'
import type { Graph } from '@/pure/graph'

// === POSITIONING ===

export type ApplyPositions = (graph: Graph) => Graph
export const applyPositions: ApplyPositions = applyPositionsImpl

export { rebaseNewClusterPositions } from './rebaseNewClusterPositions'
