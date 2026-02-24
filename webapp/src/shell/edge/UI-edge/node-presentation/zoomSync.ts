import type { Core, CollectionReturnValue } from 'cytoscape';
import type { NodePresentation } from '@/pure/graph/node-presentation/types';
import { CIRCLE_SIZE } from '@/pure/graph/node-presentation/types';
import { computeMorphValues, type MorphValues, type ZoomZone } from '@/pure/graph/node-presentation/zoomMorph';
import { getAllPresentations, getPresentation } from './NodePresentationStore';
import { createCardEditor, closeEditor } from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD';
import type { EditorData } from '@/shell/edge/UI-edge/state/UIAppState';
import { getCurrentIndex } from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import { getVisibleNodeIds } from '@/utils/viewportVisibility';
import { diffVisibleNodes } from '@/pure/graph/spatial';
import type { SpatialIndex } from '@/pure/graph/spatial';
import type { NodeIdAndFilePath } from '@/pure/graph';

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

// Module-level zone tracker — detect global zone transitions for card editor lifecycle
let previousZone: ZoomZone = 'plain';
let visibleCardNodes: Set<string> = new Set();

// Track active card editors by nodeId (not in EditorStore until pinned via dblclick)
const activeCardEditors: Map<string, EditorData> = new Map();

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

    // Skip hidden elements (e.g., hidden during card editor mode)
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
 * Create a unified card editor for a node, hiding its NodePresentation.
 * Card editor is a floating window with card-header + CM, hover wiring built in.
 * Content is loaded async via IPC inside createCardEditor.
 */
function mountCardEditorForNode(cy: Core, nodeId: string): void {
    // Don't double-mount
    if (activeCardEditors.has(nodeId)) return;

    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (presentation) {
        // Don't mount if presentation is in an unexpected state
        if (presentation.state === 'CM_EDIT') return;
        // Hide NodePresentation — card editor provides the visual in card zone
        presentation.element.style.display = 'none';
        presentation.state = 'CM_CARD';
        presentation.element.classList.remove('state-plain');
        presentation.element.classList.add('state-cm_card');
    }

    // Get title/preview from Cy node data (canonical source)
    const cyNode: CollectionReturnValue = cy.getElementById(nodeId);
    const title: string = (cyNode.data('label') as string | undefined) ?? nodeId;
    const content: string = (cyNode.data('content') as string | undefined) ?? '';
    // Simple preview: strip leading markdown title, take first 150 chars (CSS line-clamp constrains further)
    const preview: string = content.replace(/^#.*\n?/, '').trim().slice(0, 150);

    // createCardEditor is async but the card path is internally synchronous.
    // The Promise resolves in the next microtask — safe for zone transition batching.
    void createCardEditor(cy, nodeId as NodeIdAndFilePath, title, preview).then((ed: EditorData | undefined): void => {
        if (ed) activeCardEditors.set(nodeId, ed);
    });
}

/**
 * Close a card editor for a node, restoring its NodePresentation to visible PLAIN state.
 */
function closeCardEditorForNode(cy: Core, nodeId: string): void {
    const ed: EditorData | undefined = activeCardEditors.get(nodeId);
    if (ed) {
        closeEditor(cy, ed);
        activeCardEditors.delete(nodeId);
    }

    // Restore NodePresentation visibility
    const presentation: NodePresentation | undefined = getPresentation(nodeId);
    if (presentation) {
        presentation.element.style.display = '';
        presentation.state = 'PLAIN';
        presentation.element.classList.remove('state-cm_card', 'state-cm_edit');
        presentation.element.classList.add('state-plain');
    }
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

    // Zone transition detection — create/close card editors
    if (morphValues.zone !== previousZone) {
        if (morphValues.zone === 'card' && previousZone !== 'card') {
            // Entering card zone — create card editors for visible nodes
            const index: SpatialIndex | undefined = getCurrentIndex(cy);
            if (index) {
                const visibleIds: string[] = getVisibleNodeIds(cy, index);
                for (const id of visibleIds) {
                    mountCardEditorForNode(cy, id);
                }
                visibleCardNodes = new Set(visibleIds);
            }
        } else if (morphValues.zone !== 'card' && previousZone === 'card') {
            // Leaving card zone — close all card editors, restore presentations
            for (const [, ed] of activeCardEditors) {
                closeEditor(cy, ed);
            }
            activeCardEditors.clear();

            // Reset ALL presentations to PLAIN and restore visibility
            for (const presentation of getAllPresentations()) {
                if (presentation.state !== 'PLAIN') {
                    presentation.state = 'PLAIN';
                    presentation.element.classList.remove('state-cm_card', 'state-cm_edit');
                    presentation.element.classList.add('state-plain');
                }
                // Ensure presentations are visible again after card editors are closed
                presentation.element.style.display = '';
            }
            visibleCardNodes = new Set();
        }
        previousZone = morphValues.zone;
    }
}

/**
 * Handle pan events in card zone — create/close card editors for nodes entering/leaving viewport.
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
        mountCardEditorForNode(cy, id);
    }
    for (const id of diff.left) {
        closeCardEditorForNode(cy, id);
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
