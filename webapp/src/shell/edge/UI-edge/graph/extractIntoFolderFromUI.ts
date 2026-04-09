import type { Graph, GraphDelta, NodeIdAndFilePath } from '@vt/graph-model/pure/graph'
import { computeExtractIntoFolderGraphDelta } from '@vt/graph-model/pure/graph/graph-operations/extract-into-folder/computeExtractIntoFolderGraphDelta'
import type { Core } from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'
import type {} from '@/shell/electron'

export async function extractIntoFolderFromUI(
    selectedNodeIds: readonly NodeIdAndFilePath[],
    _cy: Core
): Promise<void> {
    if (selectedNodeIds.length < 2) {
        return
    }

    const currentGraph: Graph | undefined = await window.electronAPI?.main.getGraph()
    if (!currentGraph) {
        console.error('[extractIntoFolderFromUI] NO GRAPH IN STATE')
        return
    }

    const writePathOption: O.Option<string> | undefined = await window.electronAPI?.main.getWritePath()
    const writePath: string = writePathOption ? O.getOrElse(() => '')(writePathOption) : ''
    const graphDelta: GraphDelta = computeExtractIntoFolderGraphDelta(selectedNodeIds, currentGraph, writePath)

    if (graphDelta.length === 0) {
        console.error('[extractIntoFolderFromUI] No valid extract delta generated')
        return
    }

    try {
        await window.electronAPI?.main.applyGraphDeltaToDBThroughMemUIAndEditorExposed(graphDelta)
    } catch (error: unknown) {
        console.error('[extractIntoFolderFromUI] Failed to apply graph delta:', error)
    }
}
