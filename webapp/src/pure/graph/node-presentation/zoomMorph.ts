import { ZOOM_THRESHOLD_MIN, MORPH_RANGE, CIRCLE_SIZE, CARD_WIDTH, FOLDER_CARD_WIDTH } from './types';
import type { NodeKind } from './types';

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

export type ZoomZone = 'plain' | 'crossfade' | 'card';

export function getZoomZone(zoom: number): ZoomZone {
    const morph: number = clamp01((zoom - ZOOM_THRESHOLD_MIN) / MORPH_RANGE);
    if (morph < 0.01) return 'plain';
    if (morph > 0.99) return 'card';
    return 'crossfade';
}

export type MorphValues = {
    readonly morph: number;       // 0 = fully plain, 1 = fully card
    readonly cardOpacity: number;
    readonly cyNodeOpacity: number;
    readonly cardWidth: number;
    readonly cardMinHeight: number;
    readonly cardMaxHeight: number;
    readonly borderRadius: number;
    readonly previewOpacity: number;
    readonly accentOpacity: number;
    readonly titleFontSize: number;
    readonly pointerEvents: boolean;  // true = card receives events
    readonly zone: ZoomZone;
};

// Folder-specific dimension targets
const FOLDER_CIRCLE_SIZE: number = 40;
const FOLDER_MIN_HEIGHT: number = 90;
const FOLDER_MAX_HEIGHT: number = 110;

export function computeMorphValues(zoom: number, kind: NodeKind = 'regular'): MorphValues {
    const morph: number = clamp01((zoom - ZOOM_THRESHOLD_MIN) / MORPH_RANGE);

    const isFolder: boolean = kind === 'folder';
    const circleSize: number = isFolder ? FOLDER_CIRCLE_SIZE : CIRCLE_SIZE;
    const targetWidth: number = isFolder ? FOLDER_CARD_WIDTH : CARD_WIDTH;
    const targetMinH: number = isFolder ? FOLDER_MIN_HEIGHT : 72;
    const targetMaxH: number = isFolder ? FOLDER_MAX_HEIGHT : 96;

    return {
        morph,
        cardOpacity: smoothstep(0, 0.4, morph),
        cyNodeOpacity: 1 - smoothstep(0, 0.3, morph),
        cardWidth: lerp(circleSize, targetWidth, morph),
        cardMinHeight: lerp(circleSize, targetMinH, morph),
        cardMaxHeight: lerp(circleSize, targetMaxH, morph),
        borderRadius: lerp(circleSize / 2, 6, morph),
        previewOpacity: smoothstep(0.5, 1, morph),
        accentOpacity: lerp(0, 0.7, morph),
        titleFontSize: lerp(9, 12, morph),
        pointerEvents: morph >= 0.15,
        zone: morph < 0.01 ? 'plain' : morph > 0.99 ? 'card' : 'crossfade',
    };
}
