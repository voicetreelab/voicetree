import type { Graph, NodeIdAndFilePath } from '@vt/graph-model/graph'
import { computeExtractIntoFolderGraphDelta } from '@vt/graph-model/graph'
import type { Core } from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import type {} from '@/shell/hostApi'

export async function extractIntoFolderFromUI(
    selectedNodeIds: readonly NodeIdAndFilePath[],
    _cy: Core,
    folderNameOverride?: string
): Promise<void> {
    if (selectedNodeIds.length < 2) {
        return
    }

    const currentGraph: Graph | undefined = await window.hostAPI?.main.getGraph()
    if (!currentGraph) {
        console.error('[extractIntoFolderFromUI] NO GRAPH IN STATE')
        return
    }

    const writeFolderPathOption: O.Option<string> | undefined = await window.hostAPI?.main.getWriteFolderPath()
    const writeFolderPath: string = writeFolderPathOption ? O.getOrElse(() => '')(writeFolderPathOption) : ''
    const { delta: graphDelta, newFolderId } = computeExtractIntoFolderGraphDelta(selectedNodeIds, currentGraph, writeFolderPath, folderNameOverride)

    if (graphDelta.length === 0 || newFolderId === null) {
        console.error('[extractIntoFolderFromUI] No valid extract delta generated')
        return
    }

    try {
        await window.hostAPI?.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(graphDelta)
        await window.hostAPI?.main.collapseFolderThroughDaemon(newFolderId)
    } catch (error: unknown) {
        console.error('[extractIntoFolderFromUI] Failed to apply graph delta:', error)
    }
}
