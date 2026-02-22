import type { Core, CollectionReturnValue } from 'cytoscape';
import type { NodePresentation } from '@/pure/graph/node-presentation/types';
import { CIRCLE_SIZE } from '@/pure/graph/node-presentation/types';
import { computeMorphValues, type MorphValues, type ZoomZone } from '@/pure/graph/node-presentation/zoomMorph';
import { getAllPresentations } from './NodePresentationStore';

// Zone cache — only update Cy node styles on zone transitions
const zoneCache: WeakMap<HTMLElement, ZoomZone> = new WeakMap();

// Child element cache — avoid repeated querySelector per frame
interface ChildCache {
    readonly preview: HTMLElement | null;
    readonly accent: HTMLElement | null;
    readonly title: HTMLElement | null;
    readonly body: HTMLElement | null;
}
const childCache: WeakMap<HTMLElement, ChildCache> = new WeakMap();

function getChildren(el: HTMLElement): ChildCache {
    let cached: ChildCache | undefined = childCache.get(el);
    if (!cached) {
        cached = {
            preview: el.querySelector<HTMLElement>('.node-presentation-preview'),
            accent: el.querySelector<HTMLElement>('.node-presentation-accent'),
            title: el.querySelector<HTMLElement>('.node-presentation-title'),
            body: el.querySelector<HTMLElement>('.node-presentation-body'),
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

    // Skip presentations that are in editor states (HOVER/ANCHORED manage their own display)
    if (presentation.state === 'HOVER' || presentation.state === 'ANCHORED') return;
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
 * Update all presentations from current zoom level.
 * Called on cy.on('zoom'). Pre-computes both regular and folder morph values,
 * then dispatches per-presentation by kind. Stays O(N) with ~1us overhead.
 */
export function updateAllFromZoom(cy: Core, zoom: number): void {
    const regularMorph: MorphValues = computeMorphValues(zoom, 'regular');
    const folderMorph: MorphValues = computeMorphValues(zoom, 'folder');
    for (const presentation of getAllPresentations()) {
        const morph: MorphValues = presentation.kind === 'folder' ? folderMorph : regularMorph;
        updatePresentationFromZoom(cy, presentation, zoom, morph);
    }
}

/**
 * Force refresh a single presentation's zoom state.
 * Clears zone cache and re-runs morph with kind-aware dimensions.
 * Used after editor closes to restore correct Cy node + card state.
 */
export function forceRefreshPresentation(cy: Core, presentation: NodePresentation, zoom: number): void {
    zoneCache.delete(presentation.element);
    const morphValues: MorphValues = computeMorphValues(zoom, presentation.kind);
    updatePresentationFromZoom(cy, presentation, zoom, morphValues);
}
