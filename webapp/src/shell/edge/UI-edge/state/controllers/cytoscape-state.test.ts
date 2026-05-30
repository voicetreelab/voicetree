import {describe, it, expect, beforeEach} from 'vitest';
import type {Core} from 'cytoscape';
import {
    setCyInstance,
    clearCyInstance,
    getCyInstance,
    isCyInitialized,
    getCyZoom,
} from './cytoscape-state';

/**
 * Minimal Core stub — only the surface the cy-state gate touches (destroyed(),
 * zoom()). `kill()` flips it to the destroyed state so we can assert the gate
 * treats a torn-down instance as absent.
 */
function makeFakeCy(zoom: number = 1): Core & { kill: () => void } {
    let destroyed: boolean = false;
    return {
        destroyed: () => destroyed,
        zoom: () => zoom,
        kill: () => { destroyed = true; },
    } as unknown as Core & { kill: () => void };
}

describe('cytoscape-state gate', () => {
    beforeEach(() => {
        clearCyInstance();
    });

    it('getCyInstance throws before a cy is set, returns it after', () => {
        expect(isCyInitialized()).toBe(false);
        expect(() => getCyInstance()).toThrow();

        const cy: Core = makeFakeCy();
        setCyInstance(cy);

        expect(isCyInitialized()).toBe(true);
        expect(getCyInstance()).toBe(cy);
    });

    it('clearCyInstance retires the instance: getCyInstance throws again', () => {
        const cy: Core = makeFakeCy();
        setCyInstance(cy);
        clearCyInstance();

        expect(isCyInitialized()).toBe(false);
        expect(() => getCyInstance()).toThrow();
    });

    it('a destroyed cy is treated as absent', () => {
        const cy: Core & { kill: () => void } = makeFakeCy();
        setCyInstance(cy);
        cy.kill();

        expect(isCyInitialized()).toBe(false);
        expect(() => getCyInstance()).toThrow();
    });

    it('getCyZoom returns the live zoom, or the fallback when no live cy exists', () => {
        expect(getCyZoom()).toBe(1); // default fallback
        expect(getCyZoom(0.5)).toBe(0.5);

        const cy: Core = makeFakeCy(2.5);
        setCyInstance(cy);
        expect(getCyZoom()).toBe(2.5);

        clearCyInstance();
        expect(getCyZoom(0.5)).toBe(0.5);
    });
});
