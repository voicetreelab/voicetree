import { listSnapshotDocuments } from '../src/fixtures'

const REQUIRED_FIELDS = [
    'graph.nodes',
    'graph.incomingEdgesIndex',
    'graph.nodeByBaseName',
    'graph.unresolvedLinksIndex',
    'roots.loaded',
    'roots.folderTree',
    'collapseSet',
    'selection',
    'layout.positions',
    'layout.zoom',
    'layout.pan',
    'layout.fit',
    'meta.schemaVersion',
    'meta.revision',
    'meta.mutatedAt',
] as const

function fieldPresent(field: (typeof REQUIRED_FIELDS)[number], snapshot: ReturnType<typeof listSnapshotDocuments>[number]): boolean {
    const { state } = snapshot.doc

    switch (field) {
        case 'graph.nodes':
            return Object.keys(state.graph.nodes).length > 0
        case 'graph.incomingEdgesIndex':
            return state.graph.incomingEdgesIndex.length > 0
        case 'graph.nodeByBaseName':
            return state.graph.nodeByBaseName.length > 0
        case 'graph.unresolvedLinksIndex':
            return state.graph.unresolvedLinksIndex.length > 0
        case 'roots.loaded':
            return state.roots.loaded.length > 0
        case 'roots.folderTree':
            return state.roots.folderTree.length > 0
        case 'collapseSet':
            return state.collapseSet.length > 0
        case 'selection':
            return state.selection.length > 0
        case 'layout.positions':
            return state.layout.positions.length > 0
        case 'layout.zoom':
            return state.layout.zoom !== undefined
        case 'layout.pan':
            return state.layout.pan !== undefined
        case 'layout.fit':
            return state.layout.fit !== undefined
        case 'meta.schemaVersion':
            return state.meta.schemaVersion === 1
        case 'meta.revision':
            return typeof state.meta.revision === 'number'
        case 'meta.mutatedAt':
            return typeof state.meta.mutatedAt === 'string'
    }
}

function main(): void {
    const snapshots = listSnapshotDocuments()
    const covered = REQUIRED_FIELDS.filter((field) => snapshots.some((snapshot) => fieldPresent(field, snapshot)))
    const missing = REQUIRED_FIELDS.filter((field) => !covered.includes(field))

    if (missing.length > 0) {
        throw new Error(`Missing state-field coverage for: ${missing.join(', ')}`)
    }

    console.log(`Fields covered: ${covered.length}/${REQUIRED_FIELDS.length}`)
}

main()
