import type { Core } from 'cytoscape'
import * as O from 'fp-ts/lib/Option.js'

import type { FolderId } from '@vt/graph-state/contract'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import { findVisibleCollapsedAncestorForNode } from '@vt/graph-state/project-helpers'

import { getTerminals } from '@/shell/edge/UI-edge/state/stores/TerminalStore'
import { getShadowNodeId, getTerminalId } from '@/shell/edge/UI-edge/floating-windows/anchoring/types'

// The structural tether between a terminal's shadow node and the graph node it
// is anchored to (the visible line; it also participates in Cola layout). Class
// matches the edge anchorToNode creates.
const ANCHOR_EDGE_CLASS = 'terminal-indicator'

/** A terminal's shadow node and the logical graph node it is anchored to. */
export interface ShadowAnchor {
    readonly shadowNodeId: string
    readonly anchoredNodeId: string
}

/** Anchored terminals currently in the store, paired with their shadow node id. */
export function collectShadowAnchors(): readonly ShadowAnchor[] {
    const anchors: ShadowAnchor[] = []
    for (const terminal of getTerminals().values()) {
        if (!O.isSome(terminal.anchoredToNodeId)) continue
        anchors.push({
            shadowNodeId: getShadowNodeId(getTerminalId(terminal)),
            anchoredNodeId: terminal.anchoredToNodeId.value,
        })
    }
    return anchors
}

// The folders the projection rendered as collapsed proxies ARE graph-state's
// `visibleCollapsedFolders` (a folder with a collapsed ancestor is itself
// dropped from the projection). Feeding them to the same resolver the
// projection uses reproduces its node→endpoint mapping without re-deriving
// folder ancestry from path strings here.
function visibleCollapsedFolders(graph: ProjectedGraph): ReadonlySet<FolderId> {
    const folders = new Set<FolderId>()
    for (const node of graph.nodes) {
        if (node.kind === 'folder-collapsed') folders.add(node.id as FolderId)
    }
    return folders
}

/**
 * Re-point each anchored terminal's structural anchor edge at the *visible*
 * endpoint of its logical node: the node itself when visible, else the collapsed
 * ancestor folder it now lives inside.
 *
 * Anchor edges are renderer-only, so the projection's edge rerouting never
 * touches them. Without this, collapsing a folder deletes the anchored node and
 * cytoscape cascades away its anchor edge, orphaning the terminal in empty
 * space. Mirrors how the projection reroutes real edges onto a collapsed folder.
 *
 * Idempotent; mutates `cy`. Shadow-node lifecycle (creation / teardown) is owned
 * elsewhere — this only reconciles the edge, and skips terminals whose shadow is
 * absent or whose endpoint is not yet in the graph.
 */
export function reconcileTerminalAnchorEdges(
    cy: Core,
    graph: ProjectedGraph,
    anchors: readonly ShadowAnchor[] = collectShadowAnchors(),
): void {
    const collapsedFolders = visibleCollapsedFolders(graph)
    for (const { shadowNodeId, anchoredNodeId } of anchors) {
        if (cy.getElementById(shadowNodeId).length === 0) continue
        const endpoint: string =
            findVisibleCollapsedAncestorForNode(anchoredNodeId, collapsedFolders) ?? anchoredNodeId
        if (cy.getElementById(endpoint).length === 0) continue
        ensureAnchorEdge(cy, endpoint, shadowNodeId)
    }
}

// Guarantee exactly one anchor edge into the shadow, sourced at `anchorNodeId`.
// Removes any stale anchor edges (wrong source) and adds the correct one if
// missing — so re-anchoring on collapse/expand never duplicates or orphans.
function ensureAnchorEdge(cy: Core, anchorNodeId: string, shadowNodeId: string): void {
    let alreadyCorrect = false
    cy.getElementById(shadowNodeId)
        .incomers(`edge.${ANCHOR_EDGE_CLASS}`)
        .forEach((edge) => {
            if (edge.data('source') === anchorNodeId) alreadyCorrect = true
            else edge.remove()
        })
    if (alreadyCorrect) return

    cy.add({
        group: 'edges',
        data: {
            id: `edge-${anchorNodeId}-${shadowNodeId}`,
            source: anchorNodeId,
            target: shadowNodeId,
        },
        classes: ANCHOR_EDGE_CLASS,
    })
}
