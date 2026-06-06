import type {
    FolderState,
    LayoutResponse,
    LiveStateSnapshot,
    SelectionResponse,
    ViewRecord,
} from '@vt/graph-db-client'
import {isJsonMode} from '../output'

export type CliViewRecord = ViewRecord & {
    is_active: boolean
}

export type CliFolderStateRow = {
    path: string
    state: FolderState
}

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

export function formatSelection(data: SelectionResponse): string {
    if (data.selection.length === 0) {
        return 'Selection:\n  (none)'
    }
    return ['Selection:', ...data.selection.map((nodeId: string): string => `  - ${nodeId}`)].join('\n')
}

export function formatViewList(data: readonly CliViewRecord[]): string {
    if (data.length === 0) {
        return 'Views:\n  (none)'
    }

    return [
        'Views:',
        ...data.map((view: CliViewRecord): string =>
            `  ${view.isActive ? '*' : '-'} ${view.name} (${view.viewId})`,
        ),
    ].join('\n')
}

export function formatViewActivated(data: CliViewRecord): string {
    return `Active View: ${data.name} (${data.viewId})`
}

export function formatViewCloned(data: CliViewRecord): string {
    return `Cloned View: ${data.name} (${data.viewId})`
}

export function formatViewDeleted(data: CliViewRecord): string {
    return `Deleted View: ${data.name} (${data.viewId})`
}

export function formatFolderStateRow(data: CliFolderStateRow): string {
    return `Folder State: ${data.path} -> ${data.state}`
}

export function formatViewState(data: LiveStateSnapshot): string {
    const folderStateEntries: string[] =
        data.folderState.length === 0
            ? ['Folder State:', '  (none)']
            : [
                  'Folder State:',
                  ...[...data.folderState]
                      .sort(([left], [right]): number => left.localeCompare(right))
                      .map(([folderPath, state]): string => `  - ${folderPath}: ${state}`),
              ]
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
        `Folder Roots: ${data.roots.folderTree.length}`,
        `Active View: ${data.activeView.name} (${data.activeView.viewId})`,
        ...folderStateEntries,
        ...selectionEntries,
        `Pan: ${
            data.layout.pan ? `(${data.layout.pan.x}, ${data.layout.pan.y})` : '(unset)'
        }`,
        `Zoom: ${data.layout.zoom ?? '(unset)'}`,
        ...positionEntries,
        `Revision: ${data.meta.revision}`,
    ].join('\n')
}
