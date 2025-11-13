import type {
    Graph,
    GraphDelta,
    FSWriteEffect,
    GraphNode as GraphNode,
    Env,
    NodeId
} from '@/functional/pure/graph/types.ts'
import * as TE from 'fp-ts/lib/TaskEither.js'
import * as RTE from 'fp-ts/lib/ReaderTaskEither.js'
import { pipe } from 'fp-ts/lib/function.js'
import { promises as fs } from 'fs'
import path from 'path'
import { fromNodeToMarkdownContent } from '@/functional/pure/graph/markdown-writing/node_to_markdown.ts'
import { nodeIdToFilePathWithExtension } from '@/functional/pure/graph/markdown-parsing/filename-utils.ts'
import {applyGraphDeltaToGraph} from "@/functional/pure/graph/graphDelta/applyGraphDeltaToGraph.ts";

/**
 * Helper to convert unknown errors to Error type
 */
const toError = (reason: unknown): Error =>
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
  graph: Graph,
  deltas: GraphDelta
): FSWriteEffect<Graph> {
    // Map each delta to a file write effect
    const writeEffects: readonly FSWriteEffect<void>[] = deltas.map(delta => {
        switch (delta.type) {
            case 'UpsertNode':
                return writeNodeToFile(delta.nodeToUpsert)
            case 'DeleteNode':
                return deleteNodeFile(delta.nodeId)
        }
    })

    // Compute new graph state for validation/testing
    const newGraph = applyGraphDeltaToGraph(graph, deltas)

    // Sequence all write effects and return new graph
    return pipe(
        RTE.sequenceArray(writeEffects),
        RTE.map(() => newGraph)
    )
}

/**
 * Write a node to filesystem
 */
function writeNodeToFile(node: GraphNode): FSWriteEffect<void> {
    return (env: Env) => TE.tryCatch(
        async () => {
            const markdown = fromNodeToMarkdownContent(node)
            const filename = nodeIdToFilePathWithExtension(node.relativeFilePathIsID)
            const fullPath = path.join(env.vaultPath, filename)

            // Ensure parent directory exists
            await fs.mkdir(path.dirname(fullPath), { recursive: true })
            await fs.writeFile(fullPath, markdown, 'utf-8')
        },
        toError
    )
}

/**
 * Delete a node file from filesystem
 */
function deleteNodeFile(nodeId: NodeId): FSWriteEffect<void> {
    return (env: Env) => TE.tryCatch(
        async () => {
            const filename = nodeIdToFilePathWithExtension(nodeId)
            const fullPath = path.join(env.vaultPath, filename)
            await fs.unlink(fullPath)
        },
        toError
    )
}

