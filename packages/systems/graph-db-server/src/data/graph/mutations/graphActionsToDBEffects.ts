import type {
    GraphDelta,
    FSWriteEffect,
    GraphNode as GraphNode,
    Env,
    NodeIdAndFilePath
} from '@vt/graph-model/graph'
import * as TE from 'fp-ts/lib/TaskEither.js'
import * as RTE from 'fp-ts/lib/ReaderTaskEither.js'
import { pipe } from 'fp-ts/lib/function.js'
import { promises as fs } from 'fs'
import path from 'path'
import normalizePath from 'normalize-path'
import { fromNodeToMarkdownContent } from '@vt/graph-model/markdown'
import { nodeIdToFilePathWithExtension } from '@vt/graph-model/markdown'
import { markPendingDelete, markPendingWrite } from '@vt/graph-db-server/watch-folder/pending-writes'
import { traceGraphdSpan } from '@vt/graph-db-server/watch-folder/paths/traceGraphdSpan'

/**
 * Helper to convert unknown errors to Error type
 */
const toError: (reason: unknown) => Error = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason))

type FileWritePlan = {
    readonly fullPath: string;
    readonly parentDirectory: string;
    readonly markdown: string;
};

type FileDeletePlan = {
    readonly fullPath: string;
};

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
    const relativePath: string = path.relative(rootPath, candidatePath)
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function getNodeFilePath(nodeId: NodeIdAndFilePath, projectRoot: string): string {
    const filename: string = nodeIdToFilePathWithExtension(nodeId)
    return path.isAbsolute(filename)
        ? filename
        : path.join(projectRoot, filename)
}

function createFileWritePlan(node: GraphNode, projectRoot: string): FileWritePlan {
    const fullPath: string = getNodeFilePath(node.absoluteFilePathIsID, projectRoot)
    return {
        fullPath,
        parentDirectory: path.dirname(fullPath),
        markdown: fromNodeToMarkdownContent(node)
    }
}

function createFileDeletePlan(nodeId: NodeIdAndFilePath, projectRoot: string): FileDeletePlan {
    return {
        fullPath: getNodeFilePath(nodeId, projectRoot)
    }
}

function getErrorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { readonly code?: string }).code)
        : undefined
}

function isIgnorablePruneError(error: unknown): boolean {
    const errorCode: string | undefined = getErrorCode(error)
    return errorCode === 'ENOTEMPTY' || errorCode === 'ENOENT'
}

async function ensureDirectoryExists(directoryPath: string): Promise<void> {
    await fs.mkdir(directoryPath, { recursive: true })
}

async function writeMarkdownToFile(fullPath: string, markdown: string): Promise<void> {
    await fs.writeFile(fullPath, markdown, 'utf-8')
}

// Module-scoped cache of directories we have already created (or proven to
// exist), partitioned by project root. `fs.mkdir(..., {recursive: true})` is a
// syscall per write (~30-100ms under storm); after the first write into a given
// directory we can skip the mkdir entirely. Root partitioning keeps project
// lifecycle state out of this data module's public boundary, and the write path
// retries on ENOENT if an external process removes a cached directory.
const knownExistingDirectoriesByRoot: Map<string, Set<string>> = new Map()

function knownExistingDirectoriesForRoot(rootPath: string): Set<string> {
    const rootKey = normalizePath(rootPath)
    const existing = knownExistingDirectoriesByRoot.get(rootKey)
    if (existing) return existing

    const created: Set<string> = new Set()
    knownExistingDirectoriesByRoot.set(rootKey, created)
    return created
}

function deleteKnownDirectory(rootPath: string, directoryPath: string): void {
    knownExistingDirectoriesForRoot(rootPath).delete(directoryPath)
}

async function pruneEmptyParentDirectories(filePath: string, rootPath: string): Promise<void> {
    const normalizedRootPath: string = path.resolve(rootPath)
    let currentDirectory: string = path.dirname(filePath)

    while (currentDirectory !== normalizedRootPath && isWithinRoot(currentDirectory, normalizedRootPath)) {
        try {
            await fs.rmdir(currentDirectory)
        } catch (error: unknown) {
            if (isIgnorablePruneError(error)) {
                return
            }

            throw error
        }

        // We just removed this directory; the cache must not claim it exists.
        deleteKnownDirectory(rootPath, currentDirectory)

        const parentDirectory: string = path.dirname(currentDirectory)
        if (parentDirectory === currentDirectory) {
            return
        }
        currentDirectory = parentDirectory
    }
}

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
            const plan: FileWritePlan = createFileWritePlan(node, env.projectRoot)
            const knownExistingDirectories = knownExistingDirectoriesForRoot(env.projectRoot)
            let mkdirWasSkipped = false

            await traceGraphdSpan('daemon.apply-delta.db-write.mkdir', async span => {
                if (knownExistingDirectories.has(plan.parentDirectory)) {
                    span.setAttribute('vt.mkdir.cache', 'hit')
                    mkdirWasSkipped = true
                    return
                }
                span.setAttribute('vt.mkdir.cache', 'miss')
                await ensureDirectoryExists(plan.parentDirectory)
                knownExistingDirectories.add(plan.parentDirectory)
            })

            markPendingWrite(plan.fullPath)
            await traceGraphdSpan('daemon.apply-delta.db-write.writeFile', async span => {
                span.setAttribute('vt.write.bytes', Buffer.byteLength(plan.markdown))
                try {
                    await writeMarkdownToFile(plan.fullPath, plan.markdown)
                } catch (error: unknown) {
                    if (!mkdirWasSkipped || getErrorCode(error) !== 'ENOENT') {
                        throw error
                    }

                    knownExistingDirectories.delete(plan.parentDirectory)
                    await ensureDirectoryExists(plan.parentDirectory)
                    knownExistingDirectories.add(plan.parentDirectory)
                    span.setAttribute('vt.mkdir.cache.recovered', true)
                    await writeMarkdownToFile(plan.fullPath, plan.markdown)
                }
            })
        },
        toError
    )
}

// Delete a node file from filesystem. ENOENT is treated as success: the
// post-condition (file absent) already holds, so a concurrent unlink (watcher,
// external editor, second DELETE) does not turn a node-removal into a 500.
function deleteNodeFile(nodeId: NodeIdAndFilePath): FSWriteEffect<void> {
    return (env: Env) => TE.tryCatch(
        async () => {
            const plan: FileDeletePlan = createFileDeletePlan(nodeId, env.projectRoot)

            markPendingDelete(plan.fullPath)
            try {
                await fs.unlink(plan.fullPath)
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            }
            await pruneEmptyParentDirectories(plan.fullPath, env.projectRoot)
        },
        toError
    )
}
