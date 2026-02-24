import type { Core, CollectionReturnValue } from 'cytoscape';
import type { NodePresentation } from '@/pure/graph/node-presentation/types';
import { CIRCLE_SIZE } from '@/pure/graph/node-presentation/types';
import { computeMorphValues, type MorphValues, type ZoomZone } from '@/pure/graph/node-presentation/zoomMorph';
import { getAllPresentations, getPresentation } from './NodePresentationStore';
import { mountCardCM, unmountCardCM, getCardCM } from './cardCM';
import { exitActiveCMEdit } from './hoverWiring';
import { getCurrentIndex } from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import { getVisibleNodeIds } from '@/utils/viewportVisibility';
import { diffVisibleNodes } from '@/pure/graph/spatial';
import type { SpatialIndex } from '@/pure/graph/spatial';
import { getNodeFromMainToUI } from '@/shell/edge/UI-edge/graph/getNodeFromMainToUI';
import { fromNodeToContentWithWikilinks } from '@/pure/graph/markdown-writing/node_to_markdown';
import type { GraphNode } from '@/pure/graph';
import type { CardCMInstance } from '@/pure/graph/node-presentation/cardCMTypes';

// Zone cache — only update Cy node styles on zone transitions
const zoneCache: WeakMap<HTMLElement, ZoomZone> = new WeakMap();

// Child element cache — avoid repeated querySelector per frame
interface ChildCache {
    readonly preview: HTMLElement | null;
    readonly accent: HTMLElement | null;
    readonly title: HTMLElement | null;
    readonly body: HTMLElement | null;
    readonly editor: HTMLElement | null;
}
const childCache: WeakMap<HTMLElement, ChildCache> = new WeakMap();

// Module-level zone tracker — detect global zone transitions for CM lifecycle
let previousZone: ZoomZone = 'plain';
let visibleCardNodes: Set<string> = new Set();

function getChildren(el: HTMLElement): ChildCache {
    let cached: ChildCache | undefined = childCache.get(el);
    if (!cached) {
        cached = {
            preview: el.querySelector<HTMLElement>('.node-presentation-preview'),
            accent: el.querySelector<HTMLElement>('.node-presentation-accent'),
            title: el.querySelector<HTMLElement>('.node-presentation-title'),
            body: el.querySelector<HTMLElement>('.node-presentation-body'),
            editor: el.querySelector<HTMLElement>('.node-presentation-editor'),
        };
        childCache.set(el, cached);
    }
    return cached;
}

/**
 * Update a single presentation from current zoom level.
 * Applies morph values to card DOM and Cy node opacity/dimensions.
 */
function updatePresentationFromZoom(
    cy: Core,
    presentation: NodePresentation,
    zoom: number,
    morphValues: MorphValues
): void {
    const el: HTMLElement = presentation.element;

    // Skip presentations that are in editor state (CM_EDIT manages its own display)
    if (presentation.state === 'CM_EDIT') return;
    // Skip hidden elements (e.g., during editor morph)
    if (el.style.display === 'none') return;

    // Card crossfade opacity
    el.style.opacity = String(morphValues.cardOpacity);
    el.style.pointerEvents = morphValues.pointerEvents ? '' : 'none';

    // Position from Cy node (shadow node)
    const shadowNodeId: string | undefined = el.dataset.shadowNodeId;
    if (shadowNodeId) {
        const shadowNode: CollectionReturnValue = cy.getElementById(shadowNodeId);
        if (shadowNode.length > 0) {
            const pos: { x: number; y: number } = shadowNode.position();
            el.style.left = pos.x * zoom + 'px';
            el.style.top = pos.y * zoom + 'px';

            // Cy node crossfade — show as small circle when zoomed out
            const prevZone: ZoomZone | undefined = zoneCache.get(el);
            if (morphValues.zone !== prevZone || morphValues.zone === 'crossfade') {
                zoneCache.set(el, morphValues.zone);
                if (morphValues.zone === 'plain') {
                    shadowNode.style({
                        'opacity': 1,
                        'width': CIRCLE_SIZE,
                        'height': CIRCLE_SIZE,
                        'events': 'yes',
                    } as Record<string, unknown>);
                } else if (morphValues.zone === 'card') {
                    shadowNode.style({
                        'opacity': 0,
                        'events': 'no',
                    } as Record<string, unknown>);
                } else {
                    // Crossfade
                    shadowNode.style({
                        'opacity': morphValues.cyNodeOpacity,
                        'width': CIRCLE_SIZE,
                        'height': CIRCLE_SIZE,
                        'events': 'no',
                    } as Record<string, unknown>);
                }
            }
        }
    }

    // Card dimensions morph
    el.style.width = morphValues.cardWidth + 'px';
    el.style.minHeight = morphValues.cardMinHeight + 'px';
    el.style.maxHeight = morphValues.cardMaxHeight + 'px';
    el.style.borderRadius = morphValues.borderRadius + 'px';

    // Child element styles
    const children: ChildCache = getChildren(el);
    if (children.preview) children.preview.style.opacity = String(morphValues.previewOpacity);
    if (children.accent) children.accent.style.opacity = String(morphValues.accentOpacity);
    if (children.title) {
        children.title.style.fontSize = morphValues.titleFontSize + 'px';
        children.title.style.textAlign = morphValues.morph < 0.3 ? 'center' : '';
    }
    if (children.body) {
        children.body.style.padding = morphValues.morph < 0.3 ? '4px' : '8px 12px 8px 16px';
    }

    el.style.transform = `translate(-50%, -50%) scale(${zoom})`;
}

/**
 * Mount CardCM for a node with async content loading.
 * Sets state to CM_CARD, mounts CM with empty content immediately,
 * then loads full content via IPC and updates the CM.
 */
function mountCardCMForNode(_cy: Core, nodeId: string): void {
    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (!presentation) return;
    // Don't mount if already in an editor state
    if (presentation.state === 'CM_EDIT') return;
    // Don't double-mount
    if (getCardCM(nodeId)) return;

    const editorContainer: HTMLElement | null = presentation.element.querySelector('.node-presentation-editor');
    if (!editorContainer) return;

    // Update state
    presentation.state = 'CM_CARD';
    presentation.element.classList.remove('state-plain');
    presentation.element.classList.add('state-cm_card');

    // Mount with empty content immediately (instant visual)
    mountCardCM(editorContainer, '', nodeId);

    // Async load full content (~10-50ms IPC)
    void (async (): Promise<void> => {
        try {
            const node: GraphNode = await getNodeFromMainToUI(nodeId);
            const content: string = fromNodeToContentWithWikilinks(node);
            // Re-check state hasn't changed during async gap
            const currentPres: NodePresentation | undefined = getPresentation(nodeId);
            if (currentPres?.state === 'CM_CARD' || currentPres?.state === 'CM_EDIT') {
                const inst: CardCMInstance | undefined = getCardCM(nodeId);
                if (inst) {
                    // Replace content in the CM view
                    inst.view.dispatch({
                        changes: { from: 0, to: inst.view.state.doc.length, insert: content },
                    });
                }
            }
        } catch (error: unknown) {
            console.error('[zoomSync] Failed to load content for CardCM:', error);
        }
    })();
}

/**
 * Update all presentations from current zoom level.
 * Called on cy.on('zoom'). Computes morph values once, applies to all.
 */
export function updateAllFromZoom(cy: Core, zoom: number): void {
    const morphValues: MorphValues = computeMorphValues(zoom);
    for (const presentation of getAllPresentations()) {
        updatePresentationFromZoom(cy, presentation, zoom, morphValues);
    }

    // Zone transition detection — mount/unmount CardCM
    if (morphValues.zone !== previousZone) {
        if (morphValues.zone === 'card' && previousZone !== 'card') {
            // Entering card zone — mount CM for visible nodes
            const index: SpatialIndex | undefined = getCurrentIndex(cy);
            if (index) {
                const visibleIds: string[] = getVisibleNodeIds(cy, index);
                for (const id of visibleIds) {
                    mountCardCMForNode(cy, id);
                }
                visibleCardNodes = new Set(visibleIds);
            }
        } else if (morphValues.zone !== 'card' && previousZone === 'card') {
            // Leaving card zone — exit editing, unmount all CMs, reset states
            // 1. Exit any active CM_EDIT cleanly (reconfigure → readonly, keyboard cleanup)
            exitActiveCMEdit(cy);
            // 2. Unmount tracked CMs
            for (const id of visibleCardNodes) {
                unmountCardCM(id);
            }
            // 3. Reset ALL non-PLAIN presentations to PLAIN (catches untracked nodes)
            for (const presentation of getAllPresentations()) {
                if (presentation.state !== 'PLAIN') {
                    unmountCardCM(presentation.nodeId); // safe no-op if already unmounted
                    presentation.state = 'PLAIN';
                    presentation.element.classList.remove('state-cm_card', 'state-cm_edit');
                    presentation.element.classList.add('state-plain');
                }
            }
            visibleCardNodes = new Set();
        }
        previousZone = morphValues.zone;
    }
}

/**
 * Handle pan events in card zone — mount/unmount CM for nodes entering/leaving viewport.
 * Only active when in card zone. Callers should throttle to ~16ms (rAF).
 */
export function updateVisibleCardsOnPan(cy: Core): void {
    // Only active in card zone
    if (previousZone !== 'card') return;

    const index: SpatialIndex | undefined = getCurrentIndex(cy);
    if (!index) return;

    const currentIds: string[] = getVisibleNodeIds(cy, index);
    const currentSet: Set<string> = new Set(currentIds);
    const diff: { readonly entered: readonly string[]; readonly left: readonly string[] } = diffVisibleNodes(visibleCardNodes, currentSet);

    for (const id of diff.entered) {
        mountCardCMForNode(cy, id);
    }
    for (const id of diff.left) {
        unmountCardCM(id);
        // Update presentation state back to PLAIN
        const presentation: NodePresentation | undefined = getPresentation(id);
        if (presentation && presentation.state === 'CM_CARD') {
            presentation.state = 'PLAIN';
            presentation.element.classList.remove('state-cm_card');
            presentation.element.classList.add('state-plain');
        }
    }

    visibleCardNodes = currentSet;
}

/**
 * Force refresh a single presentation's zoom state.
 * Clears zone cache and re-runs morph. Used after editor closes
 * to restore correct Cy node + card state.
 */
export function forceRefreshPresentation(cy: Core, presentation: NodePresentation, zoom: number): void {
    zoneCache.delete(presentation.element);
    const morphValues: MorphValues = computeMorphValues(zoom);
    updatePresentationFromZoom(cy, presentation, zoom, morphValues);
}
