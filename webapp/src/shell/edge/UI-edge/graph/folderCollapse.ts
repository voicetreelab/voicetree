import type { Core } from 'cytoscape'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import type {} from '@/shell/electron'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/applyGraphDeltaToUI'

function isFolderCollapsed(folderId: string): boolean {
    return typeof document !== 'undefined'
        && document.querySelector != null
        && (globalThis as unknown as { cy?: Core }).cy?.getElementById(folderId).data('collapsed') === true
}

export async function collapseFolder(cy: Core, folderId: string, syncMode: 'daemon' | 'local' = 'daemon'): Promise<void> {
    if (syncMode === 'local') return
    const graph: unknown = await window.electronAPI?.main.collapseFolderThroughDaemon(folderId)
    if (graph && typeof graph === 'object' && 'nodes' in graph) {
        applyGraphDeltaToUI(cy, graph as ProjectedGraph)
    }
}

export async function expandFolder(cy: Core, folderId: string, syncMode: 'daemon' | 'local' = 'daemon'): Promise<void> {
    if (syncMode === 'local') return
    const graph: unknown = await window.electronAPI?.main.expandFolderThroughDaemon(folderId)
    if (graph && typeof graph === 'object' && 'nodes' in graph) {
        applyGraphDeltaToUI(cy, graph as ProjectedGraph)
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
