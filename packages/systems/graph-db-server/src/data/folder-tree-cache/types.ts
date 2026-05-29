/**
 * Public types for the daemon folder-tree read model.
 *
 * The read model fronts filesystem discovery with an explicit-invalidation
 * cache. It returns RAW `DirectoryEntry` trees (no graph decoration); callers
 * apply pure transforms (e.g. `buildFolderTree`) per read.
 */

import type { AbsolutePath, DirectoryEntry } from '@vt/graph-model/folders';

/**
 * Input for reading the full directory tree under `root`.
 * `maxDepth` is optional; the read model applies a stable default so different
 * call sites share cache entries.
 */
export type RootTreeInput = {
    readonly root: AbsolutePath;
    readonly maxDepth?: number;
};

/**
 * Input for reading a depth-limited directory tree. `maxDepth` is required to
 * make the caller's intent explicit and keep the cache key stable.
 */
export type DepthLimitedTreeInput = {
    readonly root: AbsolutePath;
    readonly maxDepth: number;
};

/**
 * Explicit invalidation requests. Callers (file watcher, vault lifecycle) must
 * tell the read model when its cached view is stale; the read model never
 * polls the filesystem.
 *
 * - `all`         — clear every cached root (e.g. on shutdown / reset).
 * - `root`        — clear all entries for the exact `root` (covers all depths).
 * - `pathChanged` — clear any cached root whose root is an ancestor of (or
 *                   equal to) `absolutePath`. Used by FS watcher events.
 */
export type FolderTreeInvalidation =
    | { readonly kind: 'all' }
    | { readonly kind: 'root'; readonly root: AbsolutePath }
    | { readonly kind: 'pathChanged'; readonly absolutePath: AbsolutePath };

/**
 * Filesystem scanner contract. Injected at factory time so tests can substitute
 * a deterministic counting/failing scanner. The real implementation in
 * production is `getDirectoryTree` from `folderScanner.ts`.
 *
 * Returning `null` MUST be reserved for "root does not exist or cannot be
 * read"; the read model caches `null` like any other value, since absence is
 * a valid observation until an explicit invalidation says otherwise.
 *
 * Throwing propagates the error to all concurrent waiters and the failed
 * lookup is NOT cached (next read will retry).
 */
export type FolderTreeScanner = (
    rootPath: AbsolutePath,
    maxDepth: number,
) => Promise<DirectoryEntry | null>;

/**
 * The public, deep, narrow API for daemon-owned folder-tree reads.
 *
 * Read methods return `DirectoryEntry | null`. Decoration (isInGraph,
 * isWriteFolderPath, loadState, etc.) is a pure downstream transform and is NOT the
 * read model's concern — keeping it out lets us invalidate purely on FS
 * events, independent of graph mutations.
 */
export type FolderTreeReadModel = {
    readRootTree(input: RootTreeInput): Promise<DirectoryEntry | null>;
    readDepthLimitedTree(input: DepthLimitedTreeInput): Promise<DirectoryEntry | null>;
    invalidate(input: FolderTreeInvalidation): void;
};
