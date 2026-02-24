import type { Core, CollectionReturnValue } from 'cytoscape';
import { computeMorphValues, type MorphValues, type ZoomZone } from '@/pure/graph/node-presentation/zoomMorph';
import { createCardShell, destroyCardShell, activeCardShells } from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import { getCurrentIndex } from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import { getVisibleNodeIds } from '@/utils/viewportVisibility';
import { diffVisibleNodes } from '@/pure/graph/spatial';
import type { SpatialIndex } from '@/pure/graph/spatial';
import type { NodeIdAndFilePath } from '@/pure/graph';
import { CIRCLE_SIZE } from '@/pure/graph/node-presentation/types';

// Module-level zone tracker — detect global zone transitions for card shell lifecycle
let previousZone: ZoomZone = 'plain';
let visibleCardNodes: Set<string> = new Set();
// Tracks in-flight async createCardShell calls — prevents duplicate creation during smooth zoom
const pendingCreation: Set<string> = new Set();

/**
 * Mount a card shell for a node: hide Cy circle, create DOM-only shell.
 * Idempotent: skips if shell exists OR creation is already in flight.
 */
function mountShellForNode(cy: Core, nodeId: string): void {
    if (activeCardShells.has(nodeId) || pendingCreation.has(nodeId)) return;
    pendingCreation.add(nodeId);

    // Get title/preview from Cy node data
    const cyNode: CollectionReturnValue = cy.getElementById(nodeId);
    if (cyNode.length === 0) { pendingCreation.delete(nodeId); return; }
    const title: string = (cyNode.data('label') as string | undefined) ?? nodeId;
    const content: string = (cyNode.data('content') as string | undefined) ?? '';
    const preview: string = content.replace(/^#.*\n?/, '').trim().slice(0, 150);

    // Create shell async — hide Cy circle only AFTER shell is visible
    // (hiding before shell creation causes nodes to disappear during IPC gap)
    void createCardShell(cy, nodeId as NodeIdAndFilePath, title, preview)
        .then((): void => {
            cyNode.style({ 'opacity': 0, 'events': 'no' } as Record<string, unknown>);
        })
        .finally((): void => {
            pendingCreation.delete(nodeId);
        });
}

/**
 * Restore a Cy node to its default visible circle state.
 * Called when leaving card zone or when a node exits the viewport during pan.
 */
function restoreCyNode(cy: Core, nodeId: string): void {
    const cyNode: CollectionReturnValue = cy.getElementById(nodeId);
    if (cyNode.length > 0) {
        cyNode.style({
            'opacity': 1,
            'width': CIRCLE_SIZE,
            'height': CIRCLE_SIZE,
            'events': 'yes',
        } as Record<string, unknown>);
    }
}

/**
 * Update all card shells from current zoom level.
 * Called on cy.on('zoom'). Uses zone snap: crossfade is treated as card.
 * Creates/destroys card shells on zone transitions.
 */
export function updateAllFromZoom(cy: Core, zoom: number): void {
    const morphValues: MorphValues = computeMorphValues(zoom);
    const currentZone: ZoomZone = morphValues.zone;

    // Zone snap: treat crossfade as card (per spec: zone snap for v1)
    const effectiveZone: 'plain' | 'card' = currentZone === 'plain' ? 'plain' : 'card';
    const previousEffective: 'plain' | 'card' = previousZone === 'plain' ? 'plain' : 'card';

    if (effectiveZone !== previousEffective) {
        if (effectiveZone === 'card') {
            // Entering card zone — create shells for visible nodes, hide Cy circles
            const index: SpatialIndex | undefined = getCurrentIndex(cy);
            if (index) {
                const visibleIds: string[] = getVisibleNodeIds(cy, index);
                for (const id of visibleIds) {
                    mountShellForNode(cy, id);
                }
                visibleCardNodes = new Set(visibleIds);
            }
        } else {
            // Leaving card zone — destroy all shells, restore Cy circles
            // Snapshot keys to avoid mutating map during iteration
            for (const nodeId of [...activeCardShells.keys()]) {
                destroyCardShell(nodeId);
                restoreCyNode(cy, nodeId);
            }
            visibleCardNodes = new Set();
        }
    }

    previousZone = currentZone;
}

/**
 * Handle pan events in card zone — create/destroy card shells for nodes entering/leaving viewport.
 * Only active when in card zone (zone snap: crossfade counts as card).
 * Callers should throttle to ~16ms (rAF).
 */
export function updateVisibleCardsOnPan(cy: Core): void {
    // Only active in card zone (zone snap: crossfade counts as card)
    if (previousZone === 'plain') return;

    const index: SpatialIndex | undefined = getCurrentIndex(cy);
    if (!index) return;

    const currentIds: string[] = getVisibleNodeIds(cy, index);
    const currentSet: Set<string> = new Set(currentIds);
    const diff: { readonly entered: readonly string[]; readonly left: readonly string[] } = diffVisibleNodes(visibleCardNodes, currentSet);

    for (const id of diff.entered) {
        mountShellForNode(cy, id);
    }
    for (const id of diff.left) {
        destroyCardShell(id);
        restoreCyNode(cy, id);
    }

    visibleCardNodes = currentSet;
}
