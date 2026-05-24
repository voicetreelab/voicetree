import type { Graph, NodeIdAndFilePath } from '@vt/graph-model/graph'
import { computeExtractIntoFolderGraphDelta } from '@vt/graph-model/graph'
import type { Core } from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import type {} from '@/shell/electron'

export async function extractIntoFolderFromUI(
    selectedNodeIds: readonly NodeIdAndFilePath[],
    _cy: Core,
    folderNameOverride?: string
): Promise<void> {
    if (selectedNodeIds.length < 2) {
        return
    }

    const currentGraph: Graph | undefined = await window.electronAPI?.main.getGraph()
    if (!currentGraph) {
        console.error('[extractIntoFolderFromUI] NO GRAPH IN STATE')
        return
    }

    const writeFolderOption: O.Option<string> | undefined = await window.electronAPI?.main.getWriteFolder()
    const writeFolder: string = writeFolderOption ? O.getOrElse(() => '')(writeFolderOption) : ''
    const { delta: graphDelta, newFolderId } = computeExtractIntoFolderGraphDelta(selectedNodeIds, currentGraph, writeFolder, folderNameOverride)

    if (graphDelta.length === 0 || newFolderId === null) {
        console.error('[extractIntoFolderFromUI] No valid extract delta generated')
        return
    }

    try {
        await window.electronAPI?.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(graphDelta)
        await window.electronAPI?.main.collapseFolderThroughDaemon(newFolderId)
    } catch (error: unknown) {
        console.error('[extractIntoFolderFromUI] Failed to apply graph delta:', error)
    }
}
