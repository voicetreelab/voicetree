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
 * functions own only the pure parse → route → project composition.
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
    type ParsedQuery,
} from './transforms';

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
 * A directory scan paired with the folder path it was taken at. `entry` is the
 * recursive listing (or `null` when the scan failed / the folder was
 * unreadable, which yields no tree for that folder rather than an error).
 */
export interface FolderScan {
    readonly folder: string;
    readonly entry: DirectoryEntry | null;
}

/** Loaded paths = the write folder followed by every distinct read path. */
function loadedPathsOf(projectState: FolderProjectState): readonly string[] {
    return [
        projectState.writeFolderPath,
        ...projectState.readPaths.filter((p: string) => p !== projectState.writeFolderPath),
    ];
}

/**
 * Assemble the full folder-tree sidebar payload from already-scanned directory
 * listings. The edge performs (and failure-isolates) every FS scan, then hands
 * the root/starred/external scans here; this brands paths, derives the external
 * read-path set, and runs `buildFolderTree` over each scan.
 *
 * Which folders the edge must scan is itself a pure decision — `externalFoldersOf`
 * returns the external read paths so the edge knows what to scan before calling
 * this with the results.
 */
export function buildFolderTreeSyncProjection(
    rootScan: DirectoryEntry | null,
    starredScans: readonly FolderScan[],
    externalScans: readonly FolderScan[],
    projectState: FolderProjectState,
    starredFolders: readonly string[],
    graphFilePaths: ReadonlySet<string>,
): FolderTreeSyncProjection {
    const loadedPaths: Set<string> = new Set<string>([
        ...projectState.readPaths,
        projectState.writeFolderPath,
    ]);
    const writeFolderPath: AbsolutePath = toAbsolutePath(projectState.writeFolderPath);

    const treeOf = (entry: DirectoryEntry | null): FolderTreeNode | null =>
        entry === null ? null : buildFolderTree(entry, loadedPaths, writeFolderPath, graphFilePaths);

    const collectTrees = (scans: readonly FolderScan[]): Record<string, FolderTreeNode> => {
        const trees: Record<string, FolderTreeNode> = {};
        for (const scan of scans) {
            const tree: FolderTreeNode | null = treeOf(scan.entry);
            if (tree !== null) trees[scan.folder] = tree;
        }
        return trees;
    };

    return {
        rootTree: treeOf(rootScan),
        starredFolders,
        starredTrees: collectTrees(starredScans),
        externalTrees: collectTrees(externalScans),
    };
}

/** The read paths that live OUTSIDE the project root — the edge scans each as its own tree. */
export function externalFoldersOf(projectState: FolderProjectState): readonly string[] {
    return getExternalReadPaths(projectState.readPaths, projectState.projectRoot);
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
        scanRoot: AbsolutePath,
        isAbsolute: boolean,
    ) => Promise<readonly { readonly path: AbsolutePath; readonly modifiedAt: number }[] | null>,
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
        return getAvailableFolders(base, loadedPaths, subfolders, searchQuery, parsed.filterText);
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
    return getAvailableFolders(toAbsolutePath(projectRoot), loadedPaths, subfolders, searchQuery, filterText);
}
