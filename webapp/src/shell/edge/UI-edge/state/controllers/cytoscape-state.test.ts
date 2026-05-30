import {describe, it, expect, beforeEach} from 'vitest';
import type {Core} from 'cytoscape';
import {
    setCyInstance,
    clearCyInstance,
    whenCyReady,
    getCyInstance,
    isCyInitialized,
} from './cytoscape-state';

/**
 * Minimal Core stub — only the surface the cy-state gate touches (destroyed()).
 * `kill()` flips it to the destroyed state so we can assert the gate treats a
 * torn-down instance as absent.
 */
function makeFakeCy(): Core & { kill: () => void } {
    let destroyed: boolean = false;
    return {
        destroyed: () => destroyed,
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

    it('whenCyReady resolves immediately when a live cy already exists', async () => {
        const cy: Core = makeFakeCy();
        setCyInstance(cy);

        await expect(whenCyReady()).resolves.toBe(cy);
    });

    it('whenCyReady queues before mount and resolves on the next setCyInstance', async () => {
        const pending: Promise<Core> = whenCyReady(); // called before any cy exists
        const cy: Core = makeFakeCy();

        setCyInstance(cy); // mount replays the queued waiter

        await expect(pending).resolves.toBe(cy);
    });

    it('all waiters queued before mount resolve with the mounted cy', async () => {
        const a: Promise<Core> = whenCyReady();
        const b: Promise<Core> = whenCyReady();
        const cy: Core = makeFakeCy();

        setCyInstance(cy);

        await expect(Promise.all([a, b])).resolves.toEqual([cy, cy]);
    });

    it('clearCyInstance retires the instance: getCyInstance throws, whenCyReady re-queues', async () => {
        const first: Core = makeFakeCy();
        setCyInstance(first);
        clearCyInstance();

        expect(isCyInitialized()).toBe(false);
        expect(() => getCyInstance()).toThrow();

        const pending: Promise<Core> = whenCyReady();
        const second: Core = makeFakeCy();
        setCyInstance(second);

        await expect(pending).resolves.toBe(second);
    });

    it('a destroyed cy is treated as absent', async () => {
        const cy: Core & { kill: () => void } = makeFakeCy();
        setCyInstance(cy);
        cy.kill();

        expect(isCyInitialized()).toBe(false);
        expect(() => getCyInstance()).toThrow();

        // whenCyReady must not hand back the dead instance — it queues until a
        // fresh one mounts.
        const pending: Promise<Core> = whenCyReady();
        const fresh: Core = makeFakeCy();
        setCyInstance(fresh);

        await expect(pending).resolves.toBe(fresh);
    });
});
