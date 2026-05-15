import type {
    CollapseStateResponse,
    LayoutResponse,
    LiveStateSnapshot,
    SelectionResponse,
} from '@vt/graph-db-client'
import {isJsonMode} from '@/shell/edge/main/cli/output'

export function emitResult<T>(result: T, formatHuman: (data: T) => string, forceJson: boolean): void {
    if (forceJson || isJsonMode()) {
        console.log(JSON.stringify(result, null, 2))
        return
    }
    console.log(formatHuman(result))
}

export function formatLayout(data: LayoutResponse): string {
    const positionEntries: string[] = Object.entries(data.layout.positions)
        .sort(([left], [right]): number => left.localeCompare(right))
        .map(([nodeId, position]): string => `  - ${nodeId}: (${position.x}, ${position.y})`)

    return [
        `Pan: (${data.layout.pan.x}, ${data.layout.pan.y})`,
        `Zoom: ${data.layout.zoom}`,
        positionEntries.length === 0 ? 'Positions:\n  (none)' : ['Positions:', ...positionEntries].join('\n'),
    ].join('\n')
}

function extractCollapseSet(data: unknown): string[] {
    if (!data || typeof data !== 'object') return []
    if ('collapseSet' in data) return (data as CollapseStateResponse).collapseSet
    if ('nodes' in data) {
        return (data as {nodes: readonly {kind?: string; id: string}[]}).nodes
            .filter((n: {kind?: string}) => n.kind === 'folder-collapsed').map((n: {id: string}) => n.id)
    }
    return []
}

export function formatCollapseResult(data: unknown): string {
    const set: string[] = extractCollapseSet(data).sort()
    if (set.length === 0) return 'Collapse Set:\n  (none)'
    return ['Collapse Set:', ...set.map((id: string) => `  - ${id}`)].join('\n')
}

export function formatSelection(data: SelectionResponse): string {
    if (data.selection.length === 0) {
        return 'Selection:\n  (none)'
    }
    return ['Selection:', ...data.selection.map((nodeId: string): string => `  - ${nodeId}`)].join('\n')
}

export function formatViewState(data: LiveStateSnapshot): string {
    const collapseEntries: string[] =
        data.collapseSet.length === 0
            ? ['Collapse Set:', '  (none)']
            : ['Collapse Set:', ...[...data.collapseSet].sort().map((folderId: string): string => `  - ${folderId}`)]
    const selectionEntries: string[] =
        data.selection.length === 0
            ? ['Selection:', '  (none)']
            : ['Selection:', ...data.selection.map((nodeId: string): string => `  - ${nodeId}`)]
    const positionEntries: string[] =
        data.layout.positions.length === 0
            ? ['Positions:', '  (none)']
            : [
                  'Positions:',
                  ...[...data.layout.positions]
                      .sort(([left], [right]): number => left.localeCompare(right))
                      .map(
                          ([nodeId, position]): string =>
                              `  - ${nodeId}: (${position.x}, ${position.y})`,
                      ),
              ]

    return [
        `Graph Nodes: ${Object.keys(data.graph.nodes).length}`,
        `Loaded Roots: ${data.roots.loaded.length}`,
        `Folder Roots: ${data.roots.folderTree.length}`,
        ...collapseEntries,
        ...selectionEntries,
        `Pan: ${
            data.layout.pan ? `(${data.layout.pan.x}, ${data.layout.pan.y})` : '(unset)'
        }`,
        `Zoom: ${data.layout.zoom ?? '(unset)'}`,
        ...positionEntries,
        `Revision: ${data.meta.revision}`,
    ].join('\n')
}
