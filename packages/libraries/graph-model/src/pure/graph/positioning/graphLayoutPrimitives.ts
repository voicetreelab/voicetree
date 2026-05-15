export { createGraph } from '../construction/createGraph'
export { findFirstParentNode } from '../graph-operations/indexes/findFirstParentNode'
export {
  createSpatialIndex,
  hasNodeCollision,
  hasGraphCollision,
  insertNode,
  queryEdgesInRect,
  queryNodesInRect,
} from '../spatial'
export type {
  Rect,
  SpatialEdgeEntry,
  SpatialIndex,
  SpatialNodeEntry,
} from '../spatial'
export {
  hasEdgeCrossingsAmong,
  needsLayoutCorrection,
  rectIntersectsSegment,
  segmentsIntersect,
} from '../spatial/geometry'
export type {
  EdgeSegment,
  LocalGeometry,
} from '../spatial/geometry'
