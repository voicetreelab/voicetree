// Folder-tree projections served to the browser-mode UI: the hierarchical
// sidebar payload (root + starred + external trees) and the "add folder"
// selector results.
//
// This is the FILESYSTEM EDGE: it owns every `fs` read (and the allowlist /
// validity gating that keeps a browser inside the open project) and delegates
// the pure parse → route → project composition to graph-model's deep folder
// projections (`buildFolderTreeSyncProjection`, `resolveAvailableFolders`),
// passing its scanners in as the injected effect.

import { promises as fs } from 'fs'
import path from 'path'
import type { Stats } from 'fs'
import {
    projectFolderTreeSync,
    resolveAvailableFolders,
    type FolderProjectState,
    type FolderTreeSyncProjection,
} from '@vt/graph-model/folders'
import type { AbsolutePath, AvailableFolderItem, DirectoryEntry } from '@vt/graph-model/folders'
import { getDirectoryTree, getSubfoldersWithModifiedAt, isValidSubdirectory } from './folder-scanning.ts'
import { getStarredFolders } from './starred-folders.ts'

/**
 * Minimal structural view of the live project state the folder projections need.
 * Both `@vt/graph-db-protocol`'s `ProjectState` and the daemon client's
 * `ProjectState` are structurally assignable to this, so callers pass theirs
 * directly without this module depending on either package. Aliases graph-model's
 * `FolderProjectState` so the deep projections accept it directly.
 */
export type FolderTreeProjectState = FolderProjectState

export type FolderTreeSyncPayload = FolderTreeSyncProjection

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
 * Each scan is failure-isolated here (a single unreadable folder yields `null`
 * for that tree, never a rejection); `projectFolderTreeSync` owns the scan
 * orchestration (which folders, run concurrently so total latency is the
 * slowest scan rather than their sum) and the pure assembly into the payload.
 * This module supplies only the injected `scanFolder` effect and the live
 * starred-folder list.
 */
export async function buildFolderTreeSyncPayload(
    projectState: FolderTreeProjectState,
    graphFilePaths: ReadonlySet<string>,
): Promise<FolderTreeSyncPayload> {
    const scanFolder = async (folder: string, maxDepth?: number): Promise<DirectoryEntry | null> => {
        try {
            return maxDepth === undefined
                ? await getDirectoryTree(folder)
                : await getDirectoryTree(folder, maxDepth)
        } catch {
            return null
        }
    }

    const starredFolders: readonly string[] = await getStarredFolders()
    return projectFolderTreeSync(projectState, starredFolders, graphFilePaths, scanFolder)
}

/**
 * Resolve the "add folder" selector results for a search query, scoped to the
 * project's allowlist (project root + read paths). The pure parse → route →
 * project composition is `resolveAvailableFolders`; this supplies the injected
 * FS scan, which is where the allowlist is enforced: an absolute query is
 * honoured only when it lands inside the allowlist AND is a directory; a relative
 * query only under a validated subfolder of the project root. A rejected scan
 * (`null`) yields no results — the gateway must never let a browser browse
 * arbitrary filesystem locations.
 */
export async function selectAvailableFolders(
    projectState: FolderTreeProjectState,
    searchQuery: string,
): Promise<readonly AvailableFolderItem[]> {
    return resolveAvailableFolders(
        searchQuery,
        projectState,
        async (scanRoot: AbsolutePath, isAbsolute: boolean) => {
            if (isAbsolute) {
                if (!(await isPathWithinAllowlist(scanRoot, projectState))) return null
                try {
                    const stat: Stats = await fs.stat(scanRoot)
                    if (!stat.isDirectory()) return null
                } catch {
                    return null
                }
            } else if (scanRoot !== projectState.projectRoot) {
                if (!(await isValidSubdirectory(projectState.projectRoot, scanRoot))) return null
            }
            return getSubfoldersWithModifiedAt(scanRoot)
        },
    )
}
