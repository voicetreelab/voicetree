import type cytoscape from 'cytoscape';

// --- constants ---

export const CARD_ZOOM_MIN: number = 0.7;
export const CARD_ZOOM_MAX: number = 1.05;
const MORPH_RANGE: number = 0.35; // CARD_ZOOM_MAX - CARD_ZOOM_MIN
export const CIRCLE_SIZE: number = 30;  // px — native Cy circle size when zoomed out
const CARD_W: number = 260;

// --- pure math helpers ---

export function clamp01(t: number): number {
    return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
    const t: number = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
}

// --- Cy node crossfade zone cache (only update Cy styles on zone transitions) ---

type CyZone = 'visible' | 'crossfade' | 'hidden';
const zoneCache: WeakMap<HTMLElement, CyZone> = new WeakMap<HTMLElement, CyZone>();

// --- child element cache (per-frame per-card, avoid repeated querySelector) ---

interface CardChildCache {
    readonly preview: HTMLElement | null;
    readonly accent: HTMLElement | null;
    readonly title: HTMLElement | null;
    readonly body: HTMLElement | null;
}

const childCache: WeakMap<HTMLElement, CardChildCache> = new WeakMap<HTMLElement, CardChildCache>();

function getChildren(card: HTMLElement): CardChildCache {
    let cached: CardChildCache | undefined = childCache.get(card);
    if (!cached) {
        cached = {
            preview: card.querySelector<HTMLElement>('.node-card-preview'),
            accent: card.querySelector<HTMLElement>('.node-card-accent'),
            title: card.querySelector<HTMLElement>('.node-card-title'),
            body: card.querySelector<HTMLElement>('.node-card-body'),
        };
        childCache.set(card, cached);
    }
    return cached;
}

// --- main function ---

export function updateCardFromZoom(cy: cytoscape.Core, card: HTMLElement, zoom: number): void {
    // Early return for hidden cards (e.g. during hover morph)
    if (card.style.display === 'none') return;

    const morph: number = clamp01((zoom - CARD_ZOOM_MIN) / MORPH_RANGE);

    // Card crossfade opacity — invisible when zoomed out, fades in during morph 0→0.4
    const cardOpacity: number = smoothstep(0, 0.4, morph);
    card.style.opacity = String(cardOpacity);
    card.style.pointerEvents = morph < 0.15 ? 'none' : '';

    // Position from shadow node + Cy node crossfade
    const shadowNodeId: string | undefined = card.dataset.shadowNodeId;
    if (shadowNodeId) {
        const shadowNode: cytoscape.CollectionReturnValue = cy.getElementById(shadowNodeId);
        if (shadowNode.length > 0) {
            const pos: cytoscape.Position = shadowNode.position();
            card.style.left = pos.x * zoom + 'px';
            card.style.top = pos.y * zoom + 'px';

            // Cy node crossfade — show as small circle when zoomed out, fade during morph
            // Cy nodes are 260x80 layout anchors; override to CIRCLE_SIZE for visual rendering
            const cyOpacity: number = 1 - smoothstep(0, 0.3, morph);
            const zone: CyZone = morph < 0.01 ? 'visible' : morph > 0.35 ? 'hidden' : 'crossfade';
            const prevZone: CyZone | undefined = zoneCache.get(card);
            if (zone !== prevZone || zone === 'crossfade') {
                zoneCache.set(card, zone);
                if (zone === 'hidden') {
                    shadowNode.style({
                        'opacity': 0,
                        'events': 'no',
                    } as Record<string, unknown>);
                } else {
                    // Visible or crossfade: show as small circle with appropriate opacity
                    // Events enabled in visible zone (Cy handles hover), disabled in crossfade (avoid dual triggers)
                    shadowNode.style({
                        'opacity': zone === 'visible' ? 1 : cyOpacity,
                        'width': CIRCLE_SIZE,
                        'height': CIRCLE_SIZE,
                        'events': zone === 'visible' ? 'yes' : 'no',
                    } as Record<string, unknown>);
                }
            }
        }
    }

    // Card dimensions — morph from small circle to full card
    card.style.width = lerp(CIRCLE_SIZE, CARD_W, morph) + 'px';
    card.style.minHeight = lerp(CIRCLE_SIZE, 72, morph) + 'px';
    card.style.maxHeight = lerp(CIRCLE_SIZE, 96, morph) + 'px';
    card.style.borderRadius = lerp(CIRCLE_SIZE / 2, 6, morph) + 'px';

    // Child element styles
    const children: CardChildCache = getChildren(card);

    if (children.preview) {
        children.preview.style.opacity = String(smoothstep(0.5, 1, morph));
    }
    if (children.accent) {
        children.accent.style.opacity = String(lerp(0, 0.7, morph));
    }
    if (children.title) {
        children.title.style.fontSize = lerp(9, 12, morph) + 'px';
        children.title.style.textAlign = morph < 0.3 ? 'center' : '';
    }
    if (children.body) {
        children.body.style.padding = morph < 0.3 ? '4px' : '8px 12px 8px 16px';
    }

    card.style.transform = `translate(-50%, -50%) scale(${zoom})`;
}

/**
 * Clear zone cache for a card and re-run updateCardFromZoom.
 * Used after hover editor closes to restore correct Cy node + card state.
 */
export function forceRefreshCard(cy: cytoscape.Core, card: HTMLElement, zoom: number): void {
    zoneCache.delete(card);
    updateCardFromZoom(cy, card, zoom);
}
