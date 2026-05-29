/**
 * Daemon folder-tree read model.
 *
 * A single, daemon-owned cache fronting filesystem discovery for the folder
 * tree. The cache is keyed by `${root}::${maxDepth}` and invalidated EXPLICITLY
 * by callers (file watcher events, project lifecycle, etc.). The read model
 * never polls the filesystem and never decorates entries with graph state.
 *
 * Design constraints (see spec `daemon-folder-tree-read-model`):
 *  - Reads are deduplicated: concurrent calls for the same key share one
 *    in-flight scan.
 *  - Errors are NOT cached: a thrown scanner rejects all current waiters and
 *    the next call retries.
 *  - The scanner is injected (functional shell): this file has no `fs.*`
 *    imports. Impurity lives at the edges.
 */

import normalizePath from 'normalize-path';
import type { AbsolutePath, DirectoryEntry } from '@vt/graph-model/folders';
import type {
    DepthLimitedTreeInput,
    FolderTreeInvalidation,
    FolderTreeReadModel,
    FolderTreeScanner,
    RootTreeInput,
} from './types';

/**
 * Default max depth used when callers of `readRootTree` omit `maxDepth`.
 * Mirrors `getDirectoryTree`'s historical default so call sites that share a
 * "root tree" intent collapse onto a single cache entry.
 */
const DEFAULT_ROOT_MAX_DEPTH: number = 10;

type CacheKey = string;

type CacheEntry = {
    readonly key: CacheKey;
    readonly root: AbsolutePath;
    readonly normalizedRoot: string;
    readonly maxDepth: number;
    readonly value: DirectoryEntry | null;
};

function makeCacheKey(root: AbsolutePath, maxDepth: number): CacheKey {
    // Normalize the root for cache identity so callers that pass equivalent
    // path spellings (e.g. with/without trailing slash, mixed separators)
    // share entries. We keep the un-normalized AbsolutePath on the entry for
    // round-tripping back to callers.
    return `${normalizePath(root)}::${maxDepth}`;
}

/**
 * Normalize a path for ancestor comparison: forward slashes, no trailing `/`.
 * Mirrors the convention used by `folderScanner` and `loadGraphFromDisk`,
 * which both store paths via `normalize-path`.
 */
function normalizeForCompare(p: string): string {
    const normalized: string = normalizePath(p);
    if (normalized.length > 1 && normalized.endsWith('/')) {
        return normalized.slice(0, -1);
    }
    return normalized;
}

/**
 * True iff `candidate` is the same path as `ancestor` or lives strictly
 * underneath it. Both inputs must already be normalized via
 * `normalizeForCompare`. The trailing `/` guard prevents `/a/bc` from being
 * treated as a descendant of `/a/b`.
 */
function isPathAtOrUnder(candidate: string, ancestor: string): boolean {
    if (candidate === ancestor) return true;
    return candidate.startsWith(`${ancestor}/`);
}

/**
 * Create a fresh folder-tree read model bound to the given scanner.
 *
 * Cache state lives in this closure; create one instance per daemon process.
 * The factory is pure — no I/O happens until a read is requested.
 */
export function createFolderTreeReadModel(
    scanner: FolderTreeScanner,
): FolderTreeReadModel {
    const cache: Map<CacheKey, CacheEntry> = new Map();
    const inflight: Map<CacheKey, Promise<DirectoryEntry | null>> = new Map();

    async function read(
        root: AbsolutePath,
        maxDepth: number,
    ): Promise<DirectoryEntry | null> {
        const key: CacheKey = makeCacheKey(root, maxDepth);

        const cached: CacheEntry | undefined = cache.get(key);
        if (cached !== undefined) return cached.value;

        const pending: Promise<DirectoryEntry | null> | undefined = inflight.get(key);
        if (pending !== undefined) return pending;

        const scan: Promise<DirectoryEntry | null> = (async () => {
            try {
                const value: DirectoryEntry | null = await scanner(root, maxDepth);
                // Only commit to the cache on success. If an invalidation arrived
                // while the scan was in-flight, the entry will be overwritten on
                // the next read (we cannot detect mid-flight invalidations
                // without versioning; the spec accepts a stale read here because
                // the next FS event will invalidate again).
                cache.set(key, {
                    key,
                    root,
                    normalizedRoot: normalizeForCompare(root),
                    maxDepth,
                    value,
                });
                return value;
            } finally {
                // Always clear in-flight whether we cached or threw. On throw we
                // leave `cache` untouched so the next read retries.
                inflight.delete(key);
            }
        })();

        inflight.set(key, scan);
        return scan;
    }

    function readRootTree(input: RootTreeInput): Promise<DirectoryEntry | null> {
        const maxDepth: number = input.maxDepth ?? DEFAULT_ROOT_MAX_DEPTH;
        return read(input.root, maxDepth);
    }

    function readDepthLimitedTree(
        input: DepthLimitedTreeInput,
    ): Promise<DirectoryEntry | null> {
        return read(input.root, input.maxDepth);
    }

    function invalidate(input: FolderTreeInvalidation): void {
        switch (input.kind) {
            case 'all': {
                cache.clear();
                return;
            }
            case 'root': {
                const target: string = normalizeForCompare(input.root);
                for (const entry of [...cache.values()]) {
                    if (entry.normalizedRoot === target) cache.delete(entry.key);
                }
                return;
            }
            case 'pathChanged': {
                const changed: string = normalizeForCompare(input.absolutePath);
                for (const entry of [...cache.values()]) {
                    // A cached root is affected iff the changed path is at or
                    // under that root (i.e. the root is an ancestor or equal).
                    if (isPathAtOrUnder(changed, entry.normalizedRoot)) {
                        cache.delete(entry.key);
                    }
                }
                return;
            }
        }
    }

    return {
        readRootTree,
        readDepthLimitedTree,
        invalidate,
    };
}
