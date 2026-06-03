import type { Core } from 'cytoscape'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import type {} from '@/shell/hostApi'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/actions/applyGraphDeltaToUI'
import { publishLatestProjectedGraph } from '@/shell/edge/UI-edge/state/stores/LatestProjectedGraphStore'

export async function collapseFolder(cy: Core, folderId: string, syncMode: 'daemon' | 'local' = 'daemon'): Promise<void> {
    if (syncMode === 'local') return
    const graph: unknown = await window.hostAPI?.main.setFolderStateThroughDaemon(folderId, 'collapsed')
    if (graph && typeof graph === 'object' && 'nodes' in graph) {
        const projectedGraph: ProjectedGraph = graph as ProjectedGraph
        applyGraphDeltaToUI(cy, projectedGraph)
        publishLatestProjectedGraph(projectedGraph)
    }
}

export async function expandFolder(cy: Core, folderId: string, syncMode: 'daemon' | 'local' = 'daemon'): Promise<void> {
    if (syncMode === 'local') return
    const graph: unknown = await window.hostAPI?.main.setFolderStateThroughDaemon(folderId, 'expanded')
    if (graph && typeof graph === 'object' && 'nodes' in graph) {
        const projectedGraph: ProjectedGraph = graph as ProjectedGraph
        applyGraphDeltaToUI(cy, projectedGraph)
        publishLatestProjectedGraph(projectedGraph)
    }
}

export async function hideFolder(cy: Core, folderId: string): Promise<void> {
    const graph: unknown = await window.hostAPI?.main.setFolderStateThroughDaemon(folderId, 'hidden')
    if (graph && typeof graph === 'object' && 'nodes' in graph) {
        const projectedGraph: ProjectedGraph = graph as ProjectedGraph
        applyGraphDeltaToUI(cy, projectedGraph)
        publishLatestProjectedGraph(projectedGraph)
    }
}

export async function toggleFolderCollapse(cy: Core, folderId: string): Promise<void> {
    const folder: ReturnType<typeof cy.getElementById> = cy.getElementById(folderId)
    if (!folder.length || !folder.data('isFolderNode')) return

    if (folder.data('collapsed') === true) {
        await expandFolder(cy, folderId)
    } else {
        await collapseFolder(cy, folderId)
    }
}
