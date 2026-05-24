export type CollapseStrategy = 'folder-first' | 'louvain'

export interface CollapseBoundaryNode {
    readonly id: string
    readonly title: string
    readonly relPath: string
    readonly folderPath: string
    readonly outgoingIds: readonly string[]
    readonly kind?: 'file' | 'folder'
}

export interface CollapseBoundaryGraph {
    readonly rootName: string
    readonly nodes: readonly CollapseBoundaryNode[]
}

export interface CollapseCluster {
    readonly id: string
    readonly label: string
    readonly strategy: CollapseStrategy
    readonly nodeIds: readonly string[]
    readonly anchorFolderPath: string
    readonly alignedFolderPath?: string
    readonly representativeRelPath: string
    readonly internalEdgeCount: number
    readonly incomingEdgeCount: number
    readonly outgoingEdgeCount: number
    readonly boundaryEdgeCount: number
    readonly cohesion: number
}

export interface FindCollapseBoundaryOptions {
    readonly selectedIds?: readonly string[]
    readonly focusNodeId?: string
}

export interface Candidate extends CollapseCluster {
    readonly sortLabel: string
}

export interface ClusterStats {
    readonly internalEdgeCount: number
    readonly incomingEdgeCount: number
    readonly outgoingEdgeCount: number
    readonly boundaryEdgeCount: number
    readonly cohesion: number
}

export interface SelectionResult {
    readonly clusters: readonly Candidate[]
    readonly finalEntityCount: number
}
