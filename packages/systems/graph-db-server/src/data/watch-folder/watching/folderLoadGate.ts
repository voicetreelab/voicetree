/**
 * "New folders unloaded by default" — the ingestion gate for watcher 'add'.
 *
 * A folder that newly appears under a watched project (a freshly created git
 * worktree, or any directory dropped in by an external tool) must NOT auto-load
 * its markdown as graph nodes — otherwise an entire nested codebase floods the
 * workspace. Such a folder instead shows up in the folder tree as UNLOADED and
 * is one-click loadable.
 *
 * This module is the single decision point: given an added file, the currently
 * mounted watch roots, and the loaded graph, it answers whether the file's
 * containing folder is "already loaded" and therefore whether the file should
 * ingest.
 */

import normalizePath from 'normalize-path'

/** The parent directory of `filePath`, normalized to forward slashes with no
 *  trailing slash, or `null` when `filePath` has no parent segment. */
function containingFolderOf(filePath: string): string | null {
    const normalized: string = normalizePath(filePath)
    const lastSlash: number = normalized.lastIndexOf('/')
    // `<= 0` covers both "no separator" and a file sitting at the filesystem
    // root ("/x.md" → parent "" ): neither is a real project folder to gate.
    if (lastSlash <= 0) return null
    return normalized.slice(0, lastSlash)
}

/**
 * Decide whether a newly-appearing file should be ingested as a graph node.
 *
 * The file's containing folder counts as "already loaded" — so the file
 * ingests — in exactly two cases:
 *
 *   1. The folder is itself a watch root (a loaded project path: the write
 *      folder or an expanded read path). A file dropped directly into a folder
 *      the user explicitly loaded always loads, even when that folder is
 *      otherwise empty of nodes.
 *
 *   2. The folder already holds at least one loaded node (the graph contains a
 *      node id located under it). A folder with existing loaded content is, by
 *      definition, part of the loaded project, so a loose new file dropped into
 *      it loads instantly.
 *
 * A brand-new folder has neither property: none of its descendants are loaded,
 * and it is not a watch root. Every file under it is therefore skipped — and
 * because skipping never adds a node, the predicate stays `false` for the
 * folder's whole subtree no matter what order chokidar surfaces the files in.
 * This makes the decision deterministic and order-independent (no reliance on
 * `addDir`-before-`add` event ordering).
 *
 * Scope: only EXTERNAL file creation reaches this gate in practice. Notes
 * written through the app and agent `vt graph create` nodes are applied to the
 * in-memory graph directly by the daemon write path; their disk writes are
 * deduped (pending-write / recent-delta), so the feature never affects them.
 *
 * Edge case (accepted): a folder that existed at mount but held no `.md`/image
 * nodes is treated as unloaded until its first node loads — an external file
 * dropped into such an empty folder must be loaded with a click rather than
 * appearing instantly. This never causes a flood and never affects app/agent
 * writes; it is the price of a stateless, race-free rule.
 *
 * Pure: no I/O, no module state.
 *
 * @param filePath     Absolute path of the added file (any slash style).
 * @param watchRoots   Normalized (`normalizePath`) absolute paths of the
 *                     currently mounted project paths.
 * @param graphNodes   The loaded graph's `nodes` record. Only its keys (node
 *                     ids: absolute, forward-slash-normalized file paths) are
 *                     read; iterated in place so no array is allocated per call.
 */
export function shouldIngestAddedFile(
    filePath: string,
    watchRoots: ReadonlySet<string>,
    graphNodes: Readonly<Record<string, unknown>>,
): boolean {
    const folder: string | null = containingFolderOf(filePath)
    if (folder === null) return true

    if (watchRoots.has(folder)) return true

    const descendantPrefix: string = `${folder}/`
    for (const nodeId in graphNodes) {
        if (nodeId.startsWith(descendantPrefix)) return true
    }
    return false
}
