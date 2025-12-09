import type {
    GraphDelta,
    FSWriteEffect,
    GraphNode as GraphNode,
    Env,
    NodeIdAndFilePath
} from '@/pure/graph'
import * as TE from 'fp-ts/lib/TaskEither.js'
import * as RTE from 'fp-ts/lib/ReaderTaskEither.js'
import { pipe } from 'fp-ts/lib/function.js'
import { promises as fs } from 'fs'
import path from 'path'
import { fromNodeToMarkdownContent } from '@/pure/graph/markdown-writing/node_to_markdown'
import { nodeIdToFilePathWithExtension } from '@/pure/graph/markdown-parsing/filename-utils'
import { markFileWritten, markFileDeleted } from '@/shell/edge/main/state/recent-writes-store'

/**
 * Helper to convert unknown errors to Error type
 */
const toError: (reason: unknown) => Error = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason))

/**
 * Apply a user-initiated action to the graph by writing to filesystem.
 *
 * Function signature: Graph -> GraphDelta -> FSWriteEffect<Graph>
 *
 * This creates an effect that writes to the filesystem.
 * The returned graph is for validation/testing - IPC handlers should NOT use it to update state.
 * Graph state updates come from file watch handlers detecting the filesystem change.
 *
 * @returns Filesystem write effect that returns computed graph (but don't update state with it!)
 */
export function apply_graph_deltas_to_db(
  deltas: GraphDelta
): FSWriteEffect<GraphDelta> {
    // Map each delta to a file write effect
    const writeEffects: readonly FSWriteEffect<void>[] = deltas.map(delta => {
        switch (delta.type) {
            case 'UpsertNode':
                return writeNodeToFile(delta.nodeToUpsert)
            case 'DeleteNode':
                return deleteNodeFile(delta.nodeId)
        }
    })

    // do not compute new graph state (unnec computation)
    // purposefully removed, const newGraph = applyGraphDeltaToGraph(graph, deltas)

    // Sequence all write effects and return new graph
    return pipe(
        RTE.sequenceArray(writeEffects),
        RTE.map(() => deltas)
    )
}

/**
 * Write a node to filesystem
 */
function writeNodeToFile(node: GraphNode): FSWriteEffect<void> {
    return (env: Env) => TE.tryCatch(
        async () => {
            const markdown: string = fromNodeToMarkdownContent(node)
            const filename: string = nodeIdToFilePathWithExtension(node.relativeFilePathIsID)
            const fullPath: string = path.join(env.watchedDirectory, filename)

            // Ensure parent directory exists
            await fs.mkdir(path.dirname(fullPath), { recursive: true })

            // Track this write BEFORE fs.writeFile to prevent race condition:
            // chokidar callback can run at yield points, so FS event could arrive
            // between writeFile completing and markFileWritten being called
            markFileWritten(fullPath, markdown)
            await fs.writeFile(fullPath, markdown, 'utf-8')
        },
        toError
    )
}

/**
 * Delete a node file from filesystem
 */
function deleteNodeFile(nodeId: NodeIdAndFilePath): FSWriteEffect<void> {
    return (env: Env) => TE.tryCatch(
        async () => {
            const filename: string = nodeIdToFilePathWithExtension(nodeId)
            const fullPath: string = path.join(env.watchedDirectory, filename)

            // Track this delete BEFORE fs.unlink to prevent race condition
            markFileDeleted(fullPath)
            await fs.unlink(fullPath)
        },
        toError
    )
}

