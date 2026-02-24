import { describe, it, expect } from 'vitest';
import { clamp01, lerp, smoothstep, getZoomZone, computeMorphValues, type MorphValues } from './zoomMorph';
import { ZOOM_THRESHOLD_MIN, ZOOM_THRESHOLD_MAX, MORPH_RANGE, CIRCLE_SIZE, CARD_WIDTH } from './types';

describe('clamp01', () => {
    it('clamps negative values to 0', () => {
        expect(clamp01(-1)).toBe(0);
        expect(clamp01(-0.5)).toBe(0);
        expect(clamp01(-100)).toBe(0);
    });

    it('clamps values above 1 to 1', () => {
        expect(clamp01(1.5)).toBe(1);
        expect(clamp01(2)).toBe(1);
        expect(clamp01(100)).toBe(1);
    });

    it('passes through values in [0, 1]', () => {
        expect(clamp01(0)).toBe(0);
        expect(clamp01(0.5)).toBe(0.5);
        expect(clamp01(1)).toBe(1);
        expect(clamp01(0.25)).toBe(0.25);
        expect(clamp01(0.75)).toBe(0.75);
    });
});

describe('lerp', () => {
    it('returns a when t=0', () => {
        expect(lerp(10, 20, 0)).toBe(10);
    });

    it('returns b when t=1', () => {
        expect(lerp(10, 20, 1)).toBe(20);
    });

    it('returns midpoint when t=0.5', () => {
        expect(lerp(10, 20, 0.5)).toBe(15);
    });

    it('interpolates correctly for arbitrary values', () => {
        expect(lerp(0, 100, 0.25)).toBe(25);
        expect(lerp(-10, 10, 0.5)).toBe(0);
    });
});

describe('smoothstep', () => {
    it('returns 0 below edge0', () => {
        expect(smoothstep(0, 1, -1)).toBe(0);
        expect(smoothstep(0, 1, -0.5)).toBe(0);
    });

    it('returns 1 above edge1', () => {
        expect(smoothstep(0, 1, 1.5)).toBe(1);
        expect(smoothstep(0, 1, 2)).toBe(1);
    });

    it('returns 0.5 at the midpoint', () => {
        expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    });

    it('follows Hermite interpolation (3t² - 2t³)', () => {
        // At t=0.25: 3*(0.25)^2 - 2*(0.25)^3 = 3*0.0625 - 2*0.015625 = 0.1875 - 0.03125 = 0.15625
        expect(smoothstep(0, 1, 0.25)).toBeCloseTo(0.15625, 5);
        // At t=0.75: 3*(0.75)^2 - 2*(0.75)^3 = 3*0.5625 - 2*0.421875 = 1.6875 - 0.84375 = 0.84375
        expect(smoothstep(0, 1, 0.75)).toBeCloseTo(0.84375, 5);
    });

    it('returns 0 at edge0 exactly', () => {
        expect(smoothstep(0, 1, 0)).toBe(0);
    });

    it('returns 1 at edge1 exactly', () => {
        expect(smoothstep(0, 1, 1)).toBe(1);
    });
});

describe('getZoomZone', () => {
    it('returns plain when zoomed out below threshold', () => {
        expect(getZoomZone(0.2)).toBe('plain');
        expect(getZoomZone(0.5)).toBe('plain');
    });

    it('returns crossfade in the morph range', () => {
        expect(getZoomZone(0.65)).toBe('crossfade');
        expect(getZoomZone(0.68)).toBe('crossfade');
    });

    it('returns card when zoomed in past threshold', () => {
        expect(getZoomZone(1.5)).toBe('card');
        expect(getZoomZone(2.0)).toBe('card');
    });

    it('returns plain at exactly ZOOM_THRESHOLD_MIN (morph ≈ 0)', () => {
        expect(getZoomZone(ZOOM_THRESHOLD_MIN)).toBe('plain');
    });

    it('returns card at exactly ZOOM_THRESHOLD_MAX (morph = 1)', () => {
        expect(getZoomZone(ZOOM_THRESHOLD_MAX)).toBe('card');
    });

    it('returns plain well below threshold', () => {
        expect(getZoomZone(0)).toBe('plain');
    });
});

describe('computeMorphValues', () => {
    describe('at morph=0 (fully zoomed out)', () => {
        const values: MorphValues = computeMorphValues(0);

        it('has morph 0', () => {
            expect(values.morph).toBe(0);
        });

        it('has full circle dimensions', () => {
            expect(values.cardWidth).toBe(CIRCLE_SIZE);
            expect(values.cardMinHeight).toBe(CIRCLE_SIZE);
            expect(values.cardMaxHeight).toBe(CIRCLE_SIZE);
        });

        it('has circular border radius', () => {
            expect(values.borderRadius).toBe(CIRCLE_SIZE / 2);
        });

        it('has zero card opacity', () => {
            expect(values.cardOpacity).toBe(0);
        });

        it('has full cy node opacity', () => {
            expect(values.cyNodeOpacity).toBe(1);
        });

        it('has no pointer events', () => {
            expect(values.pointerEvents).toBe(false);
        });

        it('is in plain zone', () => {
            expect(values.zone).toBe('plain');
        });
    });

    describe('at morph=0.5 (mid-crossfade)', () => {
        // zoom = ZOOM_THRESHOLD_MIN + 0.5 * MORPH_RANGE
        const midZoom: number = ZOOM_THRESHOLD_MIN + 0.5 * MORPH_RANGE;
        const values: MorphValues = computeMorphValues(midZoom);

        it('has morph 0.5', () => {
            expect(values.morph).toBeCloseTo(0.5, 5);
        });

        it('has interpolated width', () => {
            const expectedWidth: number = CIRCLE_SIZE + (CARD_WIDTH - CIRCLE_SIZE) * 0.5;
            expect(values.cardWidth).toBeCloseTo(expectedWidth, 5);
        });

        it('is in crossfade zone', () => {
            expect(values.zone).toBe('crossfade');
        });

        it('has pointer events enabled (morph >= 0.15)', () => {
            expect(values.pointerEvents).toBe(true);
        });
    });

    describe('at morph=1 (fully zoomed in)', () => {
        const values: MorphValues = computeMorphValues(2.0);

        it('has morph 1', () => {
            expect(values.morph).toBe(1);
        });

        it('has full card dimensions', () => {
            expect(values.cardWidth).toBe(CARD_WIDTH);
            expect(values.cardMinHeight).toBe(72);
            expect(values.cardMaxHeight).toBe(96);
        });

        it('has card border radius', () => {
            expect(values.borderRadius).toBe(6);
        });

        it('has full card opacity', () => {
            expect(values.cardOpacity).toBe(1);
        });

        it('has zero cy node opacity', () => {
            expect(values.cyNodeOpacity).toBe(0);
        });

        it('has pointer events enabled', () => {
            expect(values.pointerEvents).toBe(true);
        });

        it('is in card zone', () => {
            expect(values.zone).toBe('card');
        });

        it('has full preview opacity', () => {
            expect(values.previewOpacity).toBe(1);
        });

        it('has full accent opacity', () => {
            expect(values.accentOpacity).toBe(0.7);
        });

        it('has card title font size', () => {
            expect(values.titleFontSize).toBe(12);
        });
    });

    describe('cardOpacity and cyNodeOpacity behavior', () => {
        it('cyNodeOpacity fades faster than cardOpacity rises', () => {
            // At morph=0.3, cyNodeOpacity should already be near 0 (smoothstep 0-0.3)
            // while cardOpacity is still building (smoothstep 0-0.4)
            const zoom: number = ZOOM_THRESHOLD_MIN + 0.3 * MORPH_RANGE;
            const values: MorphValues = computeMorphValues(zoom);
            expect(values.cyNodeOpacity).toBe(0);
            expect(values.cardOpacity).toBeGreaterThan(0);
            expect(values.cardOpacity).toBeLessThan(1);
        });
    });

    describe('pointerEvents threshold', () => {
        it('disabled below morph 0.15', () => {
            const zoom: number = ZOOM_THRESHOLD_MIN + 0.1 * MORPH_RANGE;
            const values: MorphValues = computeMorphValues(zoom);
            expect(values.pointerEvents).toBe(false);
        });

        it('enabled above morph 0.15', () => {
            const zoom: number = ZOOM_THRESHOLD_MIN + 0.16 * MORPH_RANGE;
            const values: MorphValues = computeMorphValues(zoom);
            expect(values.pointerEvents).toBe(true);
        });
    });
});

describe('constants', () => {
    it('ZOOM_THRESHOLD_MIN is 0.6125', () => {
        expect(ZOOM_THRESHOLD_MIN).toBe(0.6125);
    });

    it('ZOOM_THRESHOLD_MAX is 0.7', () => {
        expect(ZOOM_THRESHOLD_MAX).toBe(0.7);
    });

    it('MORPH_RANGE is the difference between thresholds', () => {
        expect(MORPH_RANGE).toBeCloseTo(ZOOM_THRESHOLD_MAX - ZOOM_THRESHOLD_MIN, 10);
    });

});
