export {
    createSpatialIndex,
    queryNodesInRect,
    queryEdgesInRect,
    hasNodeCollision,
    hasEdgeCollision,
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
