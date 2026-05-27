export interface SyntheticEdgeInfo {
    id: string;
    source: string;
    target: string;
    isSyntheticEdge: boolean;
    edgeCount: number | undefined;
    label: string | undefined;
}

export interface NodePosition {
    x: number;
    y: number;
}
