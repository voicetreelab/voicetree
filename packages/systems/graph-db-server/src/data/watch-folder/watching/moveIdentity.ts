/**
 * Move identity — the pure notion of "the same node, relocated on disk".
 *
 * When a loaded note is moved into a brand-new (unloaded) folder, chokidar
 * surfaces it as an `unlink` of the old path plus an `add` of the new path. The
 * ingestion gate (`folderLoadGate`) would drop the `add` (its folder is neither a
 * watch root nor holds a loaded node), so the moved node would never re-enter the
 * graph and its incoming `[[wikilink]]` edge could not heal.
 *
 * To recognise that `add` as a move rather than fresh external content, the
 * watcher compares an identity derived from the unlinked node against one derived
 * from the added file. The identity is `kind + contentWithoutYamlOrLinks` —
 * exactly the criteria the delete-step heal already uses to pair a deletion with
 * its same-basename replacement (`mapFSEventsToGraphDelta`), so there is one
 * consistent definition of "same node moved", not two to keep in sync.
 *
 * The add side reuses `parseMarkdownToGraphNode` (the same parser that produced
 * the loaded node) so the two `contentWithoutYamlOrLinks` values match
 * byte-for-byte. `contentWithoutYamlOrLinks` is independent of graph state, so an
 * empty graph suffices for the parse.
 *
 * Pure: no I/O, no module state.
 */

import type { GraphNode } from '@vt/graph-model'
import { createEmptyGraph } from '@vt/graph-model'
import { parseMarkdownToGraphNode } from '@vt/graph-model/markdown'

export interface MoveIdentity {
    readonly kind: GraphNode['kind']
    readonly contentWithoutYamlOrLinks: string
}

/** Identity of an already-loaded node (the unlink side of a move). */
export function identityOfNode(node: GraphNode): MoveIdentity {
    return { kind: node.kind, contentWithoutYamlOrLinks: node.contentWithoutYamlOrLinks }
}

/**
 * Identity of a freshly-added markdown file (the add side of a move), computed
 * by parsing raw content with the same parser used for loaded nodes. The graph
 * argument only affects edge resolution (not `contentWithoutYamlOrLinks` or
 * `kind`), so an empty graph is used.
 */
export function identityOfAddedMarkdown(content: string, filePath: string): MoveIdentity {
    return identityOfNode(parseMarkdownToGraphNode(content, filePath, createEmptyGraph()))
}

export function identitiesMatch(a: MoveIdentity, b: MoveIdentity): boolean {
    return a.kind === b.kind && a.contentWithoutYamlOrLinks === b.contentWithoutYamlOrLinks
}
