import { describe, expect, test, vi } from 'vitest';
import type { Core } from 'cytoscape';
import { correctedAtlasGc, installAtlasGcFix } from './atlasGcFix';

/**
 * A fake cytoscape WebGL `Atlas`. `canvas === null` models a locked atlas whose
 * backing canvas was freed after buffering to the GPU (the trigger condition
 * for the upstream bug). `disposed` records whether the faithful upstream gc
 * deleted it (and, in the real renderer, its GPU texture).
 */
interface FakeAtlas {
    canvas: object | null;
    keyToLocation: Map<string, string>; // styleKey -> opaque location marker
    disposed: boolean;
}

interface FakeCollection {
    atlases: FakeAtlas[];
    styleKeyToAtlas: Map<string, FakeAtlas>;
    markedKeys: Set<string>;
    gc: () => void;
}

function makeAtlas(canvas: object | null, keys: string[]): FakeAtlas {
    const keyToLocation = new Map<string, string>();
    for (const k of keys) keyToLocation.set(k, `loc:${k}`);
    return { canvas, keyToLocation, disposed: false };
}

function makeCollection(atlases: FakeAtlas[], marked: string[]): FakeCollection {
    const styleKeyToAtlas = new Map<string, FakeAtlas>();
    for (const atlas of atlases) {
        for (const k of atlas.keyToLocation.keys()) styleKeyToAtlas.set(k, atlas);
    }
    const collection: FakeCollection = {
        atlases,
        styleKeyToAtlas,
        markedKeys: new Set(marked),
        gc: () => {},
    };
    return collection;
}

/**
 * Faithful re-implementation of cytoscape 3.33.4 `AtlasCollection.gc()`,
 * INCLUDING the bug under test: surviving textures in a canvas-freed atlas are
 * dropped (not copied, not re-registered) and the atlas is disposed. Used as
 * the injected `upstreamGc` so the test proves the wrapper neutralizes the real
 * upstream behavior.
 */
function buggyUpstreamGc(collection: FakeCollection): () => void {
    return function gc(): void {
        const { markedKeys } = collection;
        if (markedKeys.size === 0) return;

        const newAtlases: FakeAtlas[] = [];
        const newStyleKeyToAtlas = new Map<string, FakeAtlas>();
        let newAtlas: FakeAtlas | null = null;

        for (const atlas of collection.atlases) {
            const keys = new Set(atlas.keyToLocation.keys());
            const keysToCollect = new Set([...markedKeys].filter(k => keys.has(k)));

            if (keysToCollect.size === 0) {
                newAtlases.push(atlas);
                keys.forEach(k => newStyleKeyToAtlas.set(k, atlas));
                continue;
            }
            if (!newAtlas) {
                newAtlas = makeAtlas({}, []);
                newAtlases.push(newAtlas);
            }
            for (const key of keys) {
                if (!keysToCollect.has(key)) {
                    if (atlas.canvas) {
                        // repack: copy survivor onto the fresh atlas
                        newAtlas.keyToLocation.set(key, atlas.keyToLocation.get(key) as string);
                        newStyleKeyToAtlas.set(key, newAtlas);
                    }
                    // else: BUG — survivor of a canvas-freed atlas is silently dropped
                }
            }
            atlas.disposed = true; // dispose() also deletes the GPU texture
        }

        collection.atlases = newAtlases;
        collection.styleKeyToAtlas = newStyleKeyToAtlas;
        collection.markedKeys = new Set();
    };
}

function runCorrectedGc(collection: FakeCollection): void {
    correctedAtlasGc(
        collection as never,
        buggyUpstreamGc(collection),
    );
}

describe('correctedAtlasGc', () => {
    test('preserves surviving textures of a canvas-freed atlas (the live bug)', () => {
        // Mirrors the observed live state: a locked, canvas-freed atlas holding
        // both changed (marked) and unchanged (surviving) label textures.
        const frozen = makeAtlas(null, ['a_0', 'a_1', 'a_2', 'b_0', 'b_1']);
        const collection = makeCollection([frozen], ['a_1']); // only a_1 actually changed

        runCorrectedGc(collection);

        // Every survivor still resolves to a live atlas; only the changed key is gone.
        for (const key of ['a_0', 'a_2', 'b_0', 'b_1']) {
            expect(collection.styleKeyToAtlas.has(key)).toBe(true);
        }
        expect(collection.styleKeyToAtlas.has('a_1')).toBe(false);
        // The frozen atlas is kept (not disposed) so its valid GPU textures survive.
        expect(frozen.disposed).toBe(false);
        expect(collection.atlases).toContain(frozen);
        expect(frozen.keyToLocation.has('a_1')).toBe(false);
    });

    test('without the fix, the faithful upstream gc loses the survivors', () => {
        // Guards that the test's upstream model actually reproduces the bug,
        // so the passing test above is meaningful.
        const frozen = makeAtlas(null, ['a_0', 'a_1', 'a_2', 'b_0', 'b_1']);
        const collection = makeCollection([frozen], ['a_1']);

        buggyUpstreamGc(collection)();

        for (const key of ['a_0', 'a_2', 'b_0', 'b_1']) {
            expect(collection.styleKeyToAtlas.has(key)).toBe(false); // lost!
        }
    });

    test('still repacks canvas-backed atlases (memory reclamation preserved)', () => {
        const backed = makeAtlas({}, ['x_0', 'x_1', 'y_0']);
        const collection = makeCollection([backed], ['x_1']);

        runCorrectedGc(collection);

        // survivors moved to a fresh atlas, old one disposed
        expect(collection.styleKeyToAtlas.has('x_0')).toBe(true);
        expect(collection.styleKeyToAtlas.has('y_0')).toBe(true);
        expect(collection.styleKeyToAtlas.has('x_1')).toBe(false);
        expect(backed.disposed).toBe(true);
    });

    test('disposes a fully-garbage canvas-freed atlas (no survivors to keep)', () => {
        const allGarbage = makeAtlas(null, ['g_0', 'g_1']);
        const collection = makeCollection([allGarbage], ['g_0', 'g_1']);

        runCorrectedGc(collection);

        expect(collection.styleKeyToAtlas.size).toBe(0);
        expect(allGarbage.disposed).toBe(true);
    });

    test('keeps a canvas-freed atlas with no garbage untouched', () => {
        const allSurvivors = makeAtlas(null, ['s_0', 's_1']);
        const other = makeAtlas({}, ['o_0']);
        const collection = makeCollection([allSurvivors, other], ['o_0']);

        runCorrectedGc(collection);

        expect(collection.styleKeyToAtlas.has('s_0')).toBe(true);
        expect(collection.styleKeyToAtlas.has('s_1')).toBe(true);
        expect(allSurvivors.disposed).toBe(false);
    });

    test('mixed atlases: drops only changed keys, keeps everything else live', () => {
        const frozen = makeAtlas(null, ['f_0', 'f_1', 'f_2']);
        const backed = makeAtlas({}, ['m_0', 'm_1']);
        const collection = makeCollection([frozen, backed], ['f_1', 'm_0']);

        runCorrectedGc(collection);

        for (const key of ['f_0', 'f_2', 'm_1']) {
            expect(collection.styleKeyToAtlas.has(key)).toBe(true);
        }
        expect(collection.styleKeyToAtlas.has('f_1')).toBe(false);
        expect(collection.styleKeyToAtlas.has('m_0')).toBe(false);
        expect(frozen.disposed).toBe(false);
        expect(backed.disposed).toBe(true);
    });

    test('no-op when nothing is marked for collection', () => {
        const frozen = makeAtlas(null, ['k_0', 'k_1']);
        const collection = makeCollection([frozen], []);

        runCorrectedGc(collection);

        expect(collection.styleKeyToAtlas.has('k_0')).toBe(true);
        expect(collection.styleKeyToAtlas.has('k_1')).toBe(true);
        expect(frozen.disposed).toBe(false);
    });

    test('falls back to stock gc (never throws) if the partition pass errors', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // An atlas whose internals don't match expectations: reading keys throws.
        const broken = {
            canvas: null,
            get keyToLocation(): Map<string, string> { throw new Error('shape changed'); },
            disposed: false,
        } as unknown as FakeAtlas;
        const collection = makeCollection([], ['x']);
        collection.atlases = [broken];
        let upstreamCalls = 0;

        expect(() =>
            correctedAtlasGc(collection as never, () => { upstreamCalls++; }),
        ).not.toThrow();
        expect(upstreamCalls).toBe(1); // stock gc still ran exactly once
        warn.mockRestore();
    });
});

describe('installAtlasGcFix', () => {
    function cyWithCollections(collections: FakeCollection[]): Core {
        return {
            renderer: () => ({
                drawing: { atlasManager: { collections: new Map(collections.map((c, i) => [String(i), c])) } },
            }),
        } as unknown as Core;
    }

    test('patches gc so a later collection-driven gc preserves survivors', () => {
        const frozen = makeAtlas(null, ['a_0', 'a_1']);
        const collection = makeCollection([frozen], ['a_1']);
        // Install the original (buggy) gc that the fix must wrap.
        collection.gc = buggyUpstreamGc(collection);

        installAtlasGcFix(cyWithCollections([collection]));
        collection.gc(); // now goes through the wrapper

        expect(collection.styleKeyToAtlas.has('a_0')).toBe(true);
        expect(frozen.disposed).toBe(false);
    });

    test('is idempotent — does not double-wrap gc', () => {
        const collection = makeCollection([makeAtlas(null, ['a_0'])], []);
        const cy = cyWithCollections([collection]);

        installAtlasGcFix(cy);
        const afterFirst = collection.gc;
        installAtlasGcFix(cy);

        expect(collection.gc).toBe(afterFirst);
    });

    test('warns and skips when atlas internals do not match expected shape', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const bogus = { atlases: 'not-an-array', gc: () => {} } as unknown as FakeCollection;
        const original = bogus.gc;

        installAtlasGcFix(cyWithCollections([bogus]));

        expect(console.warn).toHaveBeenCalledOnce();
        expect(bogus.gc).toBe(original); // unchanged
        warn.mockRestore();
    });

    test('no-op when the renderer has no WebGL atlas manager (headless)', () => {
        const cy = { renderer: () => ({}) } as unknown as Core;
        expect(() => installAtlasGcFix(cy)).not.toThrow();
    });
});
