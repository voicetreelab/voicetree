import { applyPositions as applyPositionsImpl } from './applyPositions.ts'
import type { Graph } from '@/pure/graph'

// === POSITIONING ===

export type ApplyPositions = (graph: Graph) => Graph
export const applyPositions: ApplyPositions = applyPositionsImpl
