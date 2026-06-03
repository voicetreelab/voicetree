// Folder-tree projections served to the UI: the hierarchical sidebar payload
// (root + starred + external trees) and the "add folder" selector results.
//
// These compose the pure transforms in `@vt/graph-model` (`buildFolderTree`,
// `getAvailableFolders`, `getExternalReadPaths`, `parseSearchQuery`) over the FS
// scans in `./folder-scanning`, parameterised by a minimal structural view of
// the project state so this module needs no graph-db client/protocol dependency.
// Reusable by the Electron main process and VTD alike.

import { promises as fs } from 'fs'
import path from 'path'
import type { Stats } from 'fs'
import {
    buildFolderTree,
    getAvailableFolders,
    getExternalReadPaths,
    parseSearchQuery,
    toAbsolutePath,
} from '@vt/graph-model'
import type {
    AbsolutePath,
    AvailableFolderItem,
    DirectoryEntry,
    FolderTreeNode,
    ParsedQuery,
} from '@vt/graph-model'
import { getDirectoryTree, getSubfoldersWithModifiedAt, isValidSubdirectory } from './folder-scanning.ts'
import { getStarredFolders } from './starred-folders.ts'

/**
 * Minimal structural view of the live project state the folder projections need.
 * Both `@vt/graph-db-protocol`'s `ProjectState` and the daemon client's
 * `ProjectState` are structurally assignable to this, so callers pass theirs
 * directly without this module depending on either package.
 */
export interface FolderTreeProjectState {
    readonly projectRoot: string
    readonly readPaths: readonly string[]
    readonly writeFolderPath: string
}

export type FolderTreeSyncPayload = {
    readonly externalTrees: Record<string, FolderTreeNode>
    readonly rootTree: FolderTreeNode | null
    readonly starredFolders: readonly string[]
    readonly starredTrees: Record<string, FolderTreeNode>
}

/** Loaded paths = the write folder followed by every distinct read path. */
function loadedPathsOf(projectState: FolderTreeProjectState): readonly string[] {
    return [
        projectState.writeFolderPath,
        ...projectState.readPaths.filter((p: string) => p !== projectState.writeFolderPath),
    ]
}

/**
 * Canonical absolute form of `target`: `.`/`..` segments collapsed (via
 * `path.resolve`) AND symlinks resolved (via `realpath`) on the deepest ancestor
 * that actually exists on disk. A not-yet-created tail (e.g. a file about to be
 * written) is re-appended verbatim — it cannot itself be a symlink, and the
 * `..` segments are already gone — so the result is where the path REALLY lands.
 * This is what defeats both `../` traversal and in-allowlist symlinks pointing
 * outside; a naive string prefix check sees neither.
 */
async function canonicalizePath(target: string): Promise<string> {
    const resolved: string = path.resolve(target)
    let ancestor: string = resolved
    const tail: string[] = []
    for (;;) {
        try {
            const real: string = await fs.realpath(ancestor)
            return tail.length === 0 ? real : path.join(real, ...tail)
        } catch {
            const parent: string = path.dirname(ancestor)
            // Reached the filesystem root with nothing resolvable: fall back to
            // the lexically-resolved path (already free of `..`).
            if (parent === ancestor) return resolved
            tail.unshift(path.basename(ancestor))
            ancestor = parent
        }
    }
}

/** Pure boundary check over already-canonical paths: is `target` a root or nested under one? */
function isContainedWithin(canonicalTarget: string, canonicalRoots: readonly string[]): boolean {
    return canonicalRoots.some((root: string) => {
        if (canonicalTarget === root) return true
        const prefix: string = root.endsWith(path.sep) ? root : root + path.sep
        return canonicalTarget.startsWith(prefix)
    })
}

/**
 * True when `target` is the project root, a read path, or nested under either —
 * the gateway's allowlist. VTD scopes every browser-served FS operation through
 * this so a browser can never read, browse, create in, write to, or star
 * arbitrary filesystem locations outside the open project.
 *
 * Both `target` and the roots are canonicalised (realpath + `..` collapse) before
 * the boundary check, so neither a `../` escape nor a symlink that points out of
 * the project can slip a path past the allowlist. An empty allowlist (no open
 * project) fails closed — every path is rejected.
 */
export async function isPathWithinAllowlist(
    target: string,
    projectState: FolderTreeProjectState,
): Promise<boolean> {
    const roots: readonly string[] = [projectState.projectRoot, ...projectState.readPaths]
        .filter((root: string) => root !== '')
    if (roots.length === 0) return false
    const [canonicalTarget, canonicalRoots]: [string, readonly string[]] = await Promise.all([
        canonicalizePath(target),
        Promise.all(roots.map(canonicalizePath)),
    ])
    return isContainedWithin(canonicalTarget, canonicalRoots)
}

/**
 * Build the full folder-tree sidebar payload — root tree, starred-folder trees,
 * external read-path trees — for one project state. `graphFilePaths` is the set
 * of file paths present in the graph (used to flag in-graph files); callers pass
 * `Object.keys(graph.nodes)`.
 *
 * Each scan is failure-isolated (a single unreadable folder yields `null` for
 * that tree, never a rejection) and the three groups run concurrently, so total
 * latency is the slowest scan rather than their sum.
 */
export async function buildFolderTreeSyncPayload(
    projectState: FolderTreeProjectState,
    graphFilePaths: ReadonlySet<string>,
): Promise<FolderTreeSyncPayload> {
    const loadedPaths: Set<string> = new Set<string>([
        ...projectState.readPaths,
        projectState.writeFolderPath,
    ])
    const writeFolderPath: AbsolutePath = toAbsolutePath(projectState.writeFolderPath)

    const buildTreeFor = async (
        folder: string,
        maxDepth?: number,
    ): Promise<FolderTreeNode | null> => {
        try {
            const entry: DirectoryEntry = maxDepth === undefined
                ? await getDirectoryTree(folder)
                : await getDirectoryTree(folder, maxDepth)
            return buildFolderTree(entry, loadedPaths, writeFolderPath, graphFilePaths)
        } catch {
            return null
        }
    }

    const starredFolders: readonly string[] = await getStarredFolders()
    const externalFolders: readonly string[] = getExternalReadPaths(
        projectState.readPaths,
        projectState.projectRoot,
    )

    const [rootTree, starredTreeList, externalTreeList]: [
        FolderTreeNode | null,
        readonly (FolderTreeNode | null)[],
        readonly (FolderTreeNode | null)[],
    ] = await Promise.all([
        buildTreeFor(projectState.projectRoot),
        Promise.all(starredFolders.map((folder) => buildTreeFor(folder, 3))),
        Promise.all(externalFolders.map((folder) => buildTreeFor(folder, 3))),
    ])

    const starredTrees: Record<string, FolderTreeNode> = {}
    starredFolders.forEach((folder, index) => {
        const tree: FolderTreeNode | null = starredTreeList[index]
        if (tree !== null) starredTrees[folder] = tree
    })

    const externalTrees: Record<string, FolderTreeNode> = {}
    externalFolders.forEach((folder, index) => {
        const tree: FolderTreeNode | null = externalTreeList[index]
        if (tree !== null) externalTrees[folder] = tree
    })

    return { externalTrees, rootTree, starredFolders, starredTrees }
}

/**
 * Resolve the "add folder" selector results for a search query, scoped to the
 * project's allowlist (project root + read paths). An absolute-path query is
 * honoured only when it lands inside the allowlist — the gateway must never let
 * a browser browse arbitrary filesystem locations; a relative query scans under
 * the project root (or a validated subfolder of it).
 */
export async function selectAvailableFolders(
    projectState: FolderTreeProjectState,
    searchQuery: string,
): Promise<readonly AvailableFolderItem[]> {
    const projectRoot: string = projectState.projectRoot
    if (!projectRoot) {
        return []
    }

    const loadedPaths: readonly AbsolutePath[] = loadedPathsOf(projectState).map((p: string) => toAbsolutePath(p))
    const parsed: ParsedQuery = parseSearchQuery(searchQuery)

    if (parsed.isAbsolute && parsed.basePath) {
        if (!(await isPathWithinAllowlist(parsed.basePath, projectState))) {
            return []
        }
        try {
            const stat: Stats = await fs.stat(parsed.basePath)
            if (!stat.isDirectory()) {
                return []
            }
        } catch {
            return []
        }

        const subfolders = await getSubfoldersWithModifiedAt(toAbsolutePath(parsed.basePath))
        return getAvailableFolders(
            toAbsolutePath(parsed.basePath),
            loadedPaths,
            subfolders,
            searchQuery,
            parsed.filterText,
        )
    }

    let scanRoot: AbsolutePath
    let filterText: string
    if (parsed.basePath) {
        const targetPath: string = path.join(projectRoot, parsed.basePath)
        if (!(await isValidSubdirectory(projectRoot, targetPath))) {
            return []
        }
        scanRoot = toAbsolutePath(targetPath)
        filterText = parsed.filterText
    } else {
        scanRoot = toAbsolutePath(projectRoot)
        filterText = searchQuery
    }

    const subfolders = await getSubfoldersWithModifiedAt(scanRoot)
    return getAvailableFolders(
        toAbsolutePath(projectRoot),
        loadedPaths,
        subfolders,
        searchQuery,
        filterText,
    )
}
