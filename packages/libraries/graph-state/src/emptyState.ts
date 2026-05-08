import type { State } from './contract'

export function emptyState(): State {
    return {
        graph: {
            nodes: {},
            incomingEdgesIndex: new Map(),
            nodeByBaseName: new Map(),
            unresolvedLinksIndex: new Map(),
        },
        roots: {
            loaded: new Set(),
            folderTree: [],
        },
        collapseSet: new Set(),
        selection: new Set(),
        layout: {
            positions: new Map(),
        },
        meta: {
            schemaVersion: 1,
            revision: 0,
        },
    }
}
