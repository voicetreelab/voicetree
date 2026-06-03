/**
 * Deep folder projections — the single-call compositions a filesystem edge
 * (the Electron main process, VTD's browser-mode gateway) needs to turn raw
 * directory scans into the UI's folder-tree sidebar payload and "add folder"
 * selector results.
 *
 * These exist so an edge module composes ONE graph-model symbol per logical
 * operation instead of hand-wiring four of them (`buildFolderTree`,
 * `getExternalReadPaths`, `getAvailableFolders`, `parseSearchQuery`, plus the
 * `toAbsolutePath` branding). The underlying primitives stay individually
 * exported for other consumers (graph-state, graph-tools, graph-db-server).
 *
 * Purity is preserved by INJECTING the filesystem effect as a callback: the
 * edge owns every `fs` read (and its allowlist/validity gating); these
 * functions own only the pure parse → route → project composition, plus the
 * scan ORCHESTRATION (which folders to scan, and assembling the results) — the
 * edge supplies one `scanFolder`/`scanSubfolders` effect and nothing else.
 */

import path from 'path';
import type { AbsolutePath, AvailableFolderItem, FolderTreeNode } from './types';
import { toAbsolutePath } from './types';
import {
    buildFolderTree,
    getAvailableFolders,
    getExternalReadPaths,
    parseSearchQuery,
    type DirectoryEntry,
    type RawDirectoryEntry,
    type ParsedQuery,
} from './transforms';

/** A subfolder listing as the edge scanner produces it — a plain-string path. */
type RawSubfolder = { readonly path: string; readonly modifiedAt: number };
/** The same, branded — what `getAvailableFolders` consumes. */
type BrandedSubfolder = { readonly path: AbsolutePath; readonly modifiedAt: number };

/**
 * Minimal structural view of the live project state the folder projections need.
 * Both `@vt/graph-db-protocol`'s `ProjectState` and the daemon client's
 * `ProjectState` are structurally assignable to this, so callers pass theirs
 * directly without this module depending on either package.
 */
export interface FolderProjectState {
    readonly projectRoot: string;
    readonly readPaths: readonly string[];
    readonly writeFolderPath: string;
}

/** The hierarchical folder-tree sidebar payload: root + starred + external trees. */
export interface FolderTreeSyncProjection {
    readonly externalTrees: Record<string, FolderTreeNode>;
    readonly rootTree: FolderTreeNode | null;
    readonly starredFolders: readonly string[];
    readonly starredTrees: Record<string, FolderTreeNode>;
}

/**
 * A recursive directory listing for one folder, paired with that folder path.
 * `scanFolder` returns `null` when the scan failed / the folder was unreadable,
 * which yields no tree for that folder rather than an error.
 */
export type ScanFolder = (
    folder: string,
    maxDepth?: number,
) => Promise<RawDirectoryEntry | null>;

/** Loaded paths = the write folder followed by every distinct read path. */
function loadedPathsOf(projectState: FolderProjectState): readonly string[] {
    return [
        projectState.writeFolderPath,
        ...projectState.readPaths.filter((p: string) => p !== projectState.writeFolderPath),
    ];
}

/**
 * Build the full folder-tree sidebar payload — root tree, starred-folder trees,
 * external read-path trees — for one project state. This OWNS the whole tree
 * projection: it derives which external read-paths to scan, runs the injected
 * `scanFolder` effect over the root + starred + external folders concurrently
 * (each failure-isolated by the edge's `scanFolder`), brands the write-folder
 * path, and assembles every successful scan with `buildFolderTree`.
 *
 * The edge supplies ONLY `scanFolder` (the one place `fs` and its
 * allowlist/validity gating live) and the live `starredFolders` /
 * `graphFilePaths` it already holds; it never has to know which folders are
 * "external" or how the trees are assembled.
 */
export async function projectFolderTreeSync(
    projectState: FolderProjectState,
    starredFolders: readonly string[],
    graphFilePaths: ReadonlySet<string>,
    scanFolder: ScanFolder,
): Promise<FolderTreeSyncProjection> {
    const externalFolders: readonly string[] = getExternalReadPaths(
        projectState.readPaths,
        projectState.projectRoot,
    );

    const [rootScan, starredEntries, externalEntries]: [
        RawDirectoryEntry | null,
        readonly (RawDirectoryEntry | null)[],
        readonly (RawDirectoryEntry | null)[],
    ] = await Promise.all([
        scanFolder(projectState.projectRoot),
        Promise.all(starredFolders.map((folder: string) => scanFolder(folder, 3))),
        Promise.all(externalFolders.map((folder: string) => scanFolder(folder, 3))),
    ]);

    const loadedPaths: Set<string> = new Set<string>([
        ...projectState.readPaths,
        projectState.writeFolderPath,
    ]);
    const writeFolderPath: AbsolutePath = toAbsolutePath(projectState.writeFolderPath);

    // Brand the raw scan at graph-model's boundary: a RawDirectoryEntry is
    // structurally a DirectoryEntry with unbranded paths, and AbsolutePath is a
    // compile-time-only brand over `string`, so this is a zero-cost assertion —
    // the single point that asserts "these edge-scanned paths are absolute".
    const treeOf = (entry: RawDirectoryEntry | null): FolderTreeNode | null =>
        entry === null ? null : buildFolderTree(entry as DirectoryEntry, loadedPaths, writeFolderPath, graphFilePaths);

    const collectTrees = (
        folders: readonly string[],
        entries: readonly (RawDirectoryEntry | null)[],
    ): Record<string, FolderTreeNode> => {
        const trees: Record<string, FolderTreeNode> = {};
        folders.forEach((folder: string, i: number) => {
            const tree: FolderTreeNode | null = treeOf(entries[i] ?? null);
            if (tree !== null) trees[folder] = tree;
        });
        return trees;
    };

    return {
        rootTree: treeOf(rootScan),
        starredFolders,
        starredTrees: collectTrees(starredFolders, starredEntries),
        externalTrees: collectTrees(externalFolders, externalEntries),
    };
}

/**
 * Resolve the "add folder" selector results for a search query, scoped to the
 * project's allowlist. PURE composition of `parseSearchQuery` → route → scan →
 * `getAvailableFolders`, with the filesystem scan injected as `scanSubfolders`.
 *
 * `scanSubfolders(scanRoot, isAbsolute)` is the edge's effect: it MUST enforce
 * the allowlist (an absolute query is honoured only inside the allowlist; a
 * relative query only under a validated subfolder of the project root) and
 * return the subfolders of `scanRoot`, or `null` to reject (out of bounds, not a
 * directory, or unscannable) — in which case the selector yields no results.
 *
 * The project root passed to `getAvailableFolders` follows the query: an
 * absolute query is rooted at its own base path; a relative query at the project
 * root. This matches how display paths are computed for each mode.
 */
export async function resolveAvailableFolders(
    searchQuery: string,
    projectState: FolderProjectState,
    scanSubfolders: (
        scanRoot: string,
        isAbsolute: boolean,
    ) => Promise<readonly RawSubfolder[] | null>,
): Promise<readonly AvailableFolderItem[]> {
    const projectRoot: string = projectState.projectRoot;
    if (!projectRoot) {
        return [];
    }

    const loadedPaths: readonly AbsolutePath[] = loadedPathsOf(projectState).map((p: string) => toAbsolutePath(p));
    const parsed: ParsedQuery = parseSearchQuery(searchQuery);

    if (parsed.isAbsolute && parsed.basePath) {
        const base: AbsolutePath = toAbsolutePath(parsed.basePath);
        const subfolders = await scanSubfolders(base, true);
        if (subfolders === null) return [];
        // Brand the edge's raw subfolder paths at graph-model's boundary (zero-cost
        // compile-time assertion — see treeOf above).
        return getAvailableFolders(base, loadedPaths, subfolders as readonly BrandedSubfolder[], searchQuery, parsed.filterText);
    }

    let scanRoot: AbsolutePath;
    let filterText: string;
    if (parsed.basePath) {
        scanRoot = toAbsolutePath(path.join(projectRoot, parsed.basePath));
        filterText = parsed.filterText;
    } else {
        scanRoot = toAbsolutePath(projectRoot);
        filterText = searchQuery;
    }

    const subfolders = await scanSubfolders(scanRoot, false);
    if (subfolders === null) return [];
    return getAvailableFolders(toAbsolutePath(projectRoot), loadedPaths, subfolders as readonly BrandedSubfolder[], searchQuery, filterText);
}
