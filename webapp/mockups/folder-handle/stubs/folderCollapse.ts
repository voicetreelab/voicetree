// Mockup stub for `@/shell/edge/UI-edge/graph/view/folderCollapse`.
// The real module routes through window.electronAPI → daemon → applyGraphDeltaToUI,
// which drags in posthog + terminal stores + floating editors. None of that is
// needed to demonstrate the FolderHandleService chip behaviour, so the mockup
// vite config aliases this file in. We mutate cy directly: stash descendants on
// collapse, restore them on expand.

import type { Core, NodeSingular } from 'cytoscape'

interface StashedElement {
    data: Record<string, unknown>
    position?: { x: number; y: number }
    group: 'nodes' | 'edges'
}

const stash: Map<string, StashedElement[]> = new Map()

export async function collapseFolder(cy: Core, folderId: string): Promise<void> {
    const folder: ReturnType<typeof cy.getElementById> = cy.getElementById(folderId)
    if (!folder.length || !folder.data('isFolderNode')) return
    if (folder.data('collapsed') === true) return

    const descendants = folder.descendants()
    const edges = descendants.connectedEdges().union(folder.connectedEdges())
    const elements: StashedElement[] = []
    descendants.forEach((n: NodeSingular) => {
        elements.push({
            group: 'nodes',
            data: { ...n.data() },
            position: { x: n.position('x'), y: n.position('y') },
        })
    })
    edges.forEach((e) => {
        elements.push({ group: 'edges', data: { ...e.data() } })
    })

    // ORDER MATTERS: set collapsed BEFORE removing descendants.
    // The chip's positionChip() takes the isCollapsed early-return branch and
    // skips renderedBoundingBox(), which otherwise re-enters cy's bounds event
    // loop synchronously when many descendants remove in one tick. The real
    // shipped path is shielded from this by daemon-async IPC + applyGraphDeltaToUI
    // mutation ordering; here we just sequence it correctly in the stub.
    folder.data('collapsed', true)
    descendants.remove()
    folder.grabify()
    stash.set(folderId, elements)
}

export async function expandFolder(cy: Core, folderId: string): Promise<void> {
    const folder: ReturnType<typeof cy.getElementById> = cy.getElementById(folderId)
    if (!folder.length || !folder.data('isFolderNode')) return
    if (folder.data('collapsed') !== true) return

    // The shipped FolderHandleService positionChip() reads renderedBoundingBox()
    // on a compound folder synchronously inside its own `bounds` listener.
    // On expand, re-adding descendants + flipping `collapsed=false` makes the
    // compound bounds dirty; the next bbox read inside the listener emits
    // another `bounds` event, which re-enters the same listener → recursion.
    //
    // Production avoids this because the round trip is:
    //   chevron → IPC → daemon → ProjectedGraph → applyGraphDeltaToUI.
    // IPC introduces async gaps that let cy commit bounds between mutations,
    // and applyGraphDeltaToUI's remove/re-add cycle destroys/recreates the
    // chip cleanly instead of flipping `collapsed` in-place.
    //
    // To keep the mockup interactive, expand delegates to a host-supplied
    // rebuilder (registered by main.ts) which re-renders the cy instance from
    // a clean expanded state. Same observable end-state, no re-entry.
    const rebuilder: ((folderId: string) => void) | undefined =
        (window as unknown as { __mockupExpandFolderRebuild?: (id: string) => void })
            .__mockupExpandFolderRebuild
    if (rebuilder) {
        rebuilder(folderId)
        stash.delete(folderId)
        return
    }
    // Fallback path — same risk as production if invoked without a rebuilder.
    // Kept for completeness; the chip-listener recursion may stack-overflow.
    const elements = stash.get(folderId) ?? []
    folder.data('collapsed', false)
    for (const el of elements) cy.add(el as Parameters<typeof cy.add>[0])
    folder.ungrabify()
    stash.delete(folderId)
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
