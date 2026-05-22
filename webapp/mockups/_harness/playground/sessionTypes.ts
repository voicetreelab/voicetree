// Local mirror of the daemon-side Session shape. Imported separately so the
// in-browser daemon doesn't need to pull in @vt/graph-db-server (a node-only
// package) just to type its own state.

export interface SessionLayout {
    positions: Record<string, { x: number; y: number }>
    pan: { x: number; y: number }
    zoom: number
}

export interface Session {
    readonly id: string
    collapseSet: Set<string>
    selection: Set<string>
    expandOverrides: Set<string>
    layout: SessionLayout
    lastAccessedAt: number
}
