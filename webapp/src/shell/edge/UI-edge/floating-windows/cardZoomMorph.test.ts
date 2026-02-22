import {describe, it, expect, beforeEach, vi} from 'vitest';
import {clamp01, lerp, smoothstep, updateCardFromZoom, forceRefreshCard, CARD_ZOOM_MIN, CARD_ZOOM_MAX, CIRCLE_SIZE} from './cardZoomMorph';

// =============================================================================
// Pure math helpers
// =============================================================================

describe('clamp01', () => {
    it('clamps negative values to 0', () => {
        expect(clamp01(-1)).toBe(0);
        expect(clamp01(-0.5)).toBe(0);
    });

    it('clamps values above 1 to 1', () => {
        expect(clamp01(1.5)).toBe(1);
        expect(clamp01(100)).toBe(1);
    });

    it('passes through values in [0, 1]', () => {
        expect(clamp01(0)).toBe(0);
        expect(clamp01(0.5)).toBe(0.5);
        expect(clamp01(1)).toBe(1);
    });
});

describe('lerp', () => {
    it('returns a when t=0', () => {
        expect(lerp(10, 50, 0)).toBe(10);
    });

    it('returns b when t=1', () => {
        expect(lerp(10, 50, 1)).toBe(50);
    });

    it('returns midpoint when t=0.5', () => {
        expect(lerp(0, 100, 0.5)).toBe(50);
    });

    it('interpolates correctly at arbitrary t', () => {
        expect(lerp(60, 260, 0.25)).toBeCloseTo(110);
    });
});

describe('smoothstep', () => {
    it('returns 0 below edge0', () => {
        expect(smoothstep(0.5, 1, 0.3)).toBe(0);
        expect(smoothstep(0.5, 1, 0.5)).toBe(0);
    });

    it('returns 1 above edge1', () => {
        expect(smoothstep(0.5, 1, 1.0)).toBe(1);
        expect(smoothstep(0.5, 1, 1.5)).toBe(1);
    });

    it('returns 0.5 at midpoint', () => {
        expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    });

    it('follows Hermite interpolation', () => {
        const result: number = smoothstep(0, 1, 0.25);
        const expected: number = 3 * 0.25 ** 2 - 2 * 0.25 ** 3;
        expect(result).toBeCloseTo(expected);
    });
});

// =============================================================================
// Constants
// =============================================================================

describe('constants', () => {
    it('exports correct zoom thresholds', () => {
        expect(CARD_ZOOM_MIN).toBe(0.7);
        expect(CARD_ZOOM_MAX).toBe(1.05);
    });

    it('exports circle size', () => {
        expect(CIRCLE_SIZE).toBe(30);
    });
});

// =============================================================================
// updateCardFromZoom
// =============================================================================

describe('updateCardFromZoom', () => {
    let card: HTMLDivElement;
    let mockCy: { getElementById: ReturnType<typeof vi.fn> };
    let mockShadowNodeStyle: ReturnType<typeof vi.fn>;

    function buildCardDOM(): HTMLDivElement {
        const c: HTMLDivElement = document.createElement('div');
        c.className = 'node-card';
        c.dataset.shadowNodeId = 'test-node';

        const accent: HTMLDivElement = document.createElement('div');
        accent.className = 'node-card-accent';

        const body: HTMLDivElement = document.createElement('div');
        body.className = 'node-card-body';

        const title: HTMLDivElement = document.createElement('div');
        title.className = 'node-card-title';
        title.textContent = 'Test Node';

        const preview: HTMLDivElement = document.createElement('div');
        preview.className = 'node-card-preview';
        preview.textContent = 'Preview text';

        body.appendChild(title);
        body.appendChild(preview);
        c.appendChild(accent);
        c.appendChild(body);
        return c;
    }

    beforeEach(() => {
        card = buildCardDOM();

        mockShadowNodeStyle = vi.fn();
        mockCy = {
            getElementById: vi.fn().mockReturnValue({
                length: 1,
                position: () => ({x: 100, y: 200}),
                style: mockShadowNodeStyle,
            }),
        };
    });

    it('skips hidden cards (display: none)', () => {
        card.style.display = 'none';
        updateCardFromZoom(mockCy as never, card, 1.0);
        expect(card.style.width).toBe('');
    });

    // =========================================================================
    // Card dimensions — small circle to full card
    // =========================================================================

    it('at zoom=0.5 (below threshold) -> small circle morph=0', () => {
        updateCardFromZoom(mockCy as never, card, 0.5);

        expect(card.style.width).toBe('30px');
        expect(card.style.minHeight).toBe('30px');
        expect(card.style.maxHeight).toBe('30px');
        expect(card.style.borderRadius).toBe('15px');

        const preview: HTMLElement = card.querySelector('.node-card-preview')!;
        expect(preview.style.opacity).toBe('0');

        const accent: HTMLElement = card.querySelector('.node-card-accent')!;
        expect(accent.style.opacity).toBe('0');

        const title: HTMLElement = card.querySelector('.node-card-title')!;
        expect(title.style.fontSize).toBe('9px');
        expect(title.style.textAlign).toBe('center');
    });

    it('at zoom=0.7 (exactly at threshold) -> morph=0, small circle', () => {
        updateCardFromZoom(mockCy as never, card, 0.7);

        expect(card.style.width).toBe('30px');
        expect(card.style.borderRadius).toBe('15px');
    });

    it('at zoom=0.85 (mid-morph) -> interpolated dimensions', () => {
        updateCardFromZoom(mockCy as never, card, 0.85);

        const morph: number = (0.85 - 0.7) / 0.35;
        const expectedWidth: number = 30 + (260 - 30) * morph;
        expect(parseFloat(card.style.width)).toBeCloseTo(expectedWidth, 0);

        const expectedRadius: number = 15 + (6 - 15) * morph;
        expect(parseFloat(card.style.borderRadius)).toBeCloseTo(expectedRadius, 0);
    });

    it('at zoom=1.05 (above max) -> full card morph=1', () => {
        updateCardFromZoom(mockCy as never, card, 1.05);

        expect(card.style.width).toBe('260px');
        expect(card.style.minHeight).toBe('72px');
        expect(card.style.maxHeight).toBe('96px');
        expect(card.style.borderRadius).toBe('6px');

        const preview: HTMLElement = card.querySelector('.node-card-preview')!;
        expect(preview.style.opacity).toBe('1');

        const accent: HTMLElement = card.querySelector('.node-card-accent')!;
        expect(parseFloat(accent.style.opacity)).toBeCloseTo(0.7);

        const title: HTMLElement = card.querySelector('.node-card-title')!;
        expect(title.style.fontSize).toBe('12px');
        expect(title.style.textAlign).toBe('');
    });

    it('at zoom=1.5 (well above max) -> full card, morph clamped to 1', () => {
        updateCardFromZoom(mockCy as never, card, 1.5);

        expect(card.style.width).toBe('260px');
        expect(card.style.borderRadius).toBe('6px');
    });

    // =========================================================================
    // Position + transform
    // =========================================================================

    it('sets position from shadow node', () => {
        updateCardFromZoom(mockCy as never, card, 1.0);

        expect(card.style.left).toBe('100px');
        expect(card.style.top).toBe('200px');
    });

    it('applies translate + scale transform', () => {
        updateCardFromZoom(mockCy as never, card, 0.8);

        expect(card.style.transform).toBe('translate(-50%, -50%) scale(0.8)');
    });

    // =========================================================================
    // Child element morph
    // =========================================================================

    it('preview fades in late via smoothstep', () => {
        const zoomForMorph04: number = 0.7 + 0.4 * 0.35;
        updateCardFromZoom(mockCy as never, card, zoomForMorph04);

        const preview: HTMLElement = card.querySelector('.node-card-preview')!;
        expect(parseFloat(preview.style.opacity)).toBe(0);

        const zoomForMorph075: number = 0.7 + 0.75 * 0.35;
        updateCardFromZoom(mockCy as never, card, zoomForMorph075);
        expect(parseFloat(preview.style.opacity)).toBeCloseTo(0.5);
    });

    it('body padding shrinks in circle mode', () => {
        updateCardFromZoom(mockCy as never, card, 0.5);
        const body: HTMLElement = card.querySelector('.node-card-body')!;
        expect(body.style.padding).toBe('4px');

        updateCardFromZoom(mockCy as never, card, 1.05);
        expect(body.style.padding).toBe('8px 12px 8px 16px');
    });

    // =========================================================================
    // Card crossfade opacity
    // =========================================================================

    it('card opacity is 0 at morph=0 (zoomed out)', () => {
        updateCardFromZoom(mockCy as never, card, 0.5);
        expect(card.style.opacity).toBe('0');
    });

    it('card opacity follows smoothstep(0, 0.4, morph) at mid-crossfade', () => {
        updateCardFromZoom(mockCy as never, card, 0.8);
        const morph: number = (0.8 - 0.7) / 0.35;
        const expected: number = smoothstep(0, 0.4, morph);
        expect(parseFloat(card.style.opacity)).toBeCloseTo(expected, 4);
    });

    it('card opacity is 1 at full card (morph=1)', () => {
        updateCardFromZoom(mockCy as never, card, 1.5);
        expect(card.style.opacity).toBe('1');
    });

    it('pointer-events are none when morph < 0.15', () => {
        updateCardFromZoom(mockCy as never, card, 0.5);
        expect(card.style.pointerEvents).toBe('none');
    });

    it('pointer-events are restored when morph >= 0.15', () => {
        updateCardFromZoom(mockCy as never, card, 0.77);
        expect(card.style.pointerEvents).toBe('');
    });

    // =========================================================================
    // Cy node crossfade — small circle + opacity zones
    // =========================================================================

    it('Cy node set to small circle with opacity 1 and events yes at morph=0 (visible zone)', () => {
        updateCardFromZoom(mockCy as never, card, 0.5);
        expect(mockShadowNodeStyle).toHaveBeenCalledWith(
            expect.objectContaining({ opacity: 1, width: CIRCLE_SIZE, height: CIRCLE_SIZE, events: 'yes' })
        );
    });

    it('Cy node fades during crossfade zone with events disabled', () => {
        // morph at zoom=0.77 => (0.77-0.7)/0.35 = 0.2
        updateCardFromZoom(mockCy as never, card, 0.77);
        const morph: number = (0.77 - 0.7) / 0.35;
        const expectedCyOpacity: number = 1 - smoothstep(0, 0.3, morph);
        expect(mockShadowNodeStyle).toHaveBeenCalledWith(
            expect.objectContaining({
                opacity: expect.closeTo(expectedCyOpacity, 4),
                width: CIRCLE_SIZE,
                height: CIRCLE_SIZE,
                events: 'no',
            })
        );
    });

    it('Cy node hidden in hidden zone with events disabled (morph > 0.35)', () => {
        // morph=0.5 at zoom = 0.7 + 0.5*0.35 = 0.875
        updateCardFromZoom(mockCy as never, card, 0.875);
        expect(mockShadowNodeStyle).toHaveBeenCalledWith(
            expect.objectContaining({ opacity: 0, events: 'no' })
        );
    });

    it('Cy node style not re-applied when zone is stable (visible→visible)', () => {
        updateCardFromZoom(mockCy as never, card, 0.5);
        mockShadowNodeStyle.mockClear();

        updateCardFromZoom(mockCy as never, card, 0.6);
        expect(mockShadowNodeStyle).not.toHaveBeenCalled();
    });

    it('Cy node style re-applied on zone transition (visible→crossfade)', () => {
        updateCardFromZoom(mockCy as never, card, 0.5);
        mockShadowNodeStyle.mockClear();

        updateCardFromZoom(mockCy as never, card, 0.77);
        expect(mockShadowNodeStyle).toHaveBeenCalled();
    });

    // =========================================================================
    // forceRefreshCard
    // =========================================================================

    it('forceRefreshCard clears zone cache and re-applies styles', () => {
        // Set to visible zone
        updateCardFromZoom(mockCy as never, card, 0.5);
        mockShadowNodeStyle.mockClear();

        // Same zone — normally no style update
        updateCardFromZoom(mockCy as never, card, 0.6);
        expect(mockShadowNodeStyle).not.toHaveBeenCalled();

        // forceRefreshCard clears cache — forces style update even in same zone
        forceRefreshCard(mockCy as never, card, 0.5);
        expect(mockShadowNodeStyle).toHaveBeenCalledWith(
            expect.objectContaining({ opacity: 1, events: 'yes' })
        );
    });
});
