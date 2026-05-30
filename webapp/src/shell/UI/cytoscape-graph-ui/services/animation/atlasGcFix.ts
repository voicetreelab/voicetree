/**
 * Fixes a correctness bug in cytoscape's experimental WebGL renderer that
 * causes node/edge labels to render blank ("cut off") until the node is
 * hovered or the view is otherwise forced to redraw.
 *
 * ## The bug
 *
 * The WebGL renderer rasterizes every label line into a texture atlas
 * (`AtlasCollection`). When an atlas fills up it is `lock()`-ed and a new one
 * is started; once a locked atlas has been buffered to the GPU, its backing
 * 2D canvas is freed to save memory (`Atlas.bufferIfNeeded` sets
 * `this.canvas = null`). The GPU texture itself stays valid and keeps
 * rendering.
 *
 * Periodically (debounced ~10s after any label change) the renderer runs
 * `AtlasCollection.gc()` to reclaim space taken by textures whose style key
 * changed. To repack an atlas, gc copies each *surviving* (non-collected)
 * texture onto a fresh atlas via `canvas.drawImage`. But for a locked atlas
 * whose canvas was already freed, that copy is impossible, and upstream's
 * guard simply skips it:
 *
 *     if (atlas.canvas) {                  // false for a buffered+locked atlas
 *       this._copyTextureToNewAtlas(...);
 *       newStyleKeyToAtlas.set(key, ...);  // <- never runs
 *     }
 *     // ...later: atlas.dispose() deletes the GPU texture too
 *
 * So every surviving texture in a canvas-freed atlas is dropped from the
 * cache *and* its GPU texture is deleted. Those labels then render blank.
 * Upstream relies on "it'll be redrawn next frame", but a redraw only
 * re-rasterizes them if something marks the elements dirty — which is exactly
 * what hovering a node does. On an idle graph the labels stay cut off until
 * the user hovers. Observed live: a single gc pass evicted 97 of 105 cached
 * label textures, only 8 of which had actually changed.
 *
 * ## The fix
 *
 * Intercept only the mishandled case. Before delegating to the upstream gc,
 * pull out any canvas-freed atlas that still holds surviving textures, forget
 * just its collected keys, and keep the survivors in place — their GPU
 * textures are still valid, so nothing needs re-rasterizing. Everything else
 * (canvas-backed atlases that can be repacked, and fully-garbage atlases that
 * should be disposed) is handed to the upstream gc unchanged, preserving its
 * memory-reclamation behavior.
 *
 * ## Why a runtime override (and why it's safe)
 *
 * This is a *defensive vendor patch* for cytoscape's provisional WebGL
 * renderer, in the same spirit as `installTextureCacheSkip`
 * (largegraphPerformance.ts), which already monkey-patches the same renderer's
 * internals. The override was chosen over the alternatives:
 *   - No cytoscape config/flag fixes this — `webglTexRows`/`webglTexSize` only
 *     resize the atlas (delaying locking, never preventing the gc eviction).
 *   - Not freeing the locked atlases' canvases would fix it but regress the
 *     renderer's core large-graph memory optimization (a 2048² canvas per
 *     locked atlas) and isn't reachable without patching an unexported class.
 *   - Pinning the version freezes the bug rather than fixing it.
 * The override is surgical (it changes only the mishandled gc case and keeps
 * upstream's repacking/reclamation for everything else) and lives in owned,
 * unit-tested code.
 *
 * Safety: `installAtlasGcFix` feature-detects the exact internal shape it
 * depends on; if a cytoscape upgrade changes it, the patch is NOT installed
 * (a warning is logged and stock gc keeps running). `correctedAtlasGc`
 * additionally falls back to stock gc on any unexpected runtime error, so a
 * future upgrade degrades to original behavior rather than crashing the
 * renderer's redraw loop.
 *
 * Upstream: tracking issue cytoscape/cytoscape.js#3305 (experimental WebGL
 * renderer); related label/hover symptom in #3412. No exact-match issue for
 * this gc eviction was found at cytoscape 3.33.4 — candidate to file/upstream.
 */
import type { Core } from 'cytoscape';

/** Minimal structural view of a cytoscape WebGL `Atlas`. */
interface GcAtlas {
    /** Backing 2D canvas; null once a locked atlas has been buffered to the GPU. */
    canvas: unknown | null;
    /** Map of styleKey -> texture location(s) for everything drawn into this atlas. */
    keyToLocation: Map<string, unknown>;
}

/** Minimal structural view of a cytoscape WebGL `AtlasCollection`. */
interface GcCollection {
    atlases: GcAtlas[];
    styleKeyToAtlas: Map<string, GcAtlas>;
    markedKeys: Set<string>;
    gc: () => void;
}

type PatchedGc = (() => void) & { __vtGcFixInstalled?: boolean };

/**
 * Corrected garbage collection for one `AtlasCollection`. Preserves surviving
 * textures of canvas-freed atlases that the upstream gc would otherwise drop,
 * then delegates the rest to `upstreamGc`.
 *
 * Mutates `collection` in place (matching cytoscape's own gc contract).
 * `upstreamGc` must be the original gc already bound to `collection`.
 */
export function correctedAtlasGc(collection: GcCollection, upstreamGc: () => void): void {
    const markedKeys: Set<string> = collection.markedKeys;

    const preserved: GcAtlas[] = [];

    // Partition phase. If anything here throws (e.g. a future cytoscape changed
    // the atlas internals in a way the install-time shape check didn't catch),
    // fall back to stock gc — never crash the renderer's redraw loop. This
    // phase reassigns collection.atlases only on full success, so the fallback
    // runs upstream gc against the original, untouched atlas set.
    try {
        const remaining: GcAtlas[] = [];
        for (const atlas of collection.atlases) {
            const keys: string[] = [...atlas.keyToLocation.keys()];
            let markedCount: number = 0;
            for (const key of keys) {
                if (markedKeys.has(key)) markedCount++;
            }
            const hasSurvivors: boolean = markedCount < keys.length;
            const hasGarbage: boolean = markedCount > 0;

            // Only the (canvas freed) + (mixed survivors and garbage) case is
            // mishandled upstream. A canvas-freed atlas that is all survivors is
            // kept correctly by upstream; one that is all garbage is disposed
            // correctly. Canvas-backed atlases can always be repacked.
            if (atlas.canvas === null && hasSurvivors && hasGarbage) {
                // Forget only the collected keys; the survivors' GPU textures stay valid.
                for (const key of keys) {
                    if (markedKeys.has(key)) atlas.keyToLocation.delete(key);
                }
                preserved.push(atlas);
            } else {
                remaining.push(atlas);
            }
        }
        // Upstream gc rebuilds collection.atlases + collection.styleKeyToAtlas
        // and clears markedKeys. Feed it only the atlases it handles correctly.
        collection.atlases = remaining;
    } catch (err) {
        console.warn('[atlasGcFix] atlas partition failed; using stock cytoscape gc', err);
        upstreamGc();
        return;
    }

    upstreamGc();

    if (preserved.length === 0) return;

    // Re-attach the preserved atlases at the FRONT — they are locked (a freed
    // canvas implies a locked, fully-buffered atlas) so they never accept new
    // draws; keeping them ahead of the active atlas leaves the active atlas
    // last, where AtlasCollection.draw looks for free space. Register their
    // survivors into the freshly-rebuilt lookup map.
    collection.atlases = [...preserved, ...collection.atlases];
    for (const atlas of preserved) {
        for (const key of atlas.keyToLocation.keys()) {
            collection.styleKeyToAtlas.set(key, atlas);
        }
    }
}

function isGcCollection(value: unknown): value is GcCollection {
    if (typeof value !== 'object' || value === null) return false;
    const c: Partial<GcCollection> = value as Partial<GcCollection>;
    return (
        Array.isArray(c.atlases) &&
        c.styleKeyToAtlas instanceof Map &&
        c.markedKeys instanceof Set &&
        typeof c.gc === 'function' &&
        c.atlases.every(a => a != null && a.keyToLocation instanceof Map && 'canvas' in a)
    );
}

/** Structural view of the WebGL renderer internals (not in @types/cytoscape). */
interface WebglRenderer {
    drawing?: { atlasManager?: { collections?: Map<string, unknown> } };
}
interface CoreWithRenderer {
    renderer?: () => WebglRenderer | undefined;
}

/** Reach the WebGL renderer's atlas collections, or [] if WebGL is inactive. */
function getAtlasCollections(cy: Core): unknown[] {
    const renderer: WebglRenderer | undefined = (cy as unknown as CoreWithRenderer).renderer?.();
    const collections: Map<string, unknown> | undefined = renderer?.drawing?.atlasManager?.collections;
    return collections ? [...collections.values()] : [];
}

/**
 * Install the gc integrity fix on every atlas collection of `cy`'s WebGL
 * renderer. No-op (with a warning) if the renderer is absent or its atlas
 * internals don't match the expected shape. Idempotent per collection.
 */
export function installAtlasGcFix(cy: Core): void {
    const collections: unknown[] = getAtlasCollections(cy);
    if (collections.length === 0) return; // headless / non-WebGL: no atlases to protect

    for (const collection of collections) {
        if (!isGcCollection(collection)) {
            console.warn(
                '[installAtlasGcFix] cytoscape WebGL atlas internals changed; label GC integrity fix NOT applied. ' +
                'Labels may render blank until hovered. Re-validate against the cytoscape version.'
            );
            continue;
        }

        const current: PatchedGc = collection.gc as PatchedGc;
        if (current.__vtGcFixInstalled) continue; // already patched

        const originalGc: () => void = current.bind(collection);
        const patched: PatchedGc = () => correctedAtlasGc(collection, originalGc);
        patched.__vtGcFixInstalled = true;
        collection.gc = patched;
    }
}
