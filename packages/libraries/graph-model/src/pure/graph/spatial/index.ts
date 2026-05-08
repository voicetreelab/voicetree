export {
    createSpatialIndex,
    queryNodesInRect,
    queryEdgesInRect,
    hasNodeCollision,
    hasEdgeCollision,
    hasGraphCollision,
    findObstacles,
    insertNode,
    removeNode,
    insertEdge,
    removeEdge,
} from './spatialIndex';

export type {
    Rect,
    SpatialNodeEntry,
    SpatialEdgeEntry,
    SpatialIndex,
} from './spatialIndex';

export { diffVisibleNodes } from './viewportDiff';
