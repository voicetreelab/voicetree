import * as TE from 'fp-ts/lib/TaskEither.js'
import { pipe } from 'fp-ts/lib/function.js'
import type { ShareId, ShareManifest, ViewError } from '@/pure/web-share/types'
import type { Graph, GraphDelta, Position, NodeIdAndFilePath } from '@/pure/graph'
import { buildGraphFromFiles } from '@/pure/web-share/buildGraphFromFiles'
import { mergePositionsIntoGraph, mapNewGraphToDelta } from '@/pure/graph'
import { fetchManifest, fetchFiles, fetchPositions } from './r2Client'

/**
 * Map a thrown error from r2Client to a ViewError.
 * r2Client functions throw with messages like "fetchManifest failed: 404 Not Found".
 */
function toViewError(shareId: ShareId): (err: unknown) => ViewError {
    return (err: unknown): ViewError => {
        const msg: string = String(err)
        const statusMatch: RegExpMatchArray | null = msg.match(/(\d{3})/)
        if (statusMatch && statusMatch[1] === '404') {
            return { tag: 'NotFound', shareId }
        }
        if (statusMatch) {
            return { tag: 'FetchFailed', status: parseInt(statusMatch[1]) }
        }
        return { tag: 'FetchFailed', status: 0 }
    }
}

/**
 * View pipeline: fetch manifest → parallel fetch files + positions → build graph → delta.
 * (baseUrl) => (shareId) => TaskEither<ViewError, GraphDelta>
 */
export const viewPipeline: (baseUrl: string) => (shareId: string) => TE.TaskEither<ViewError, GraphDelta> = (baseUrl: string) => (shareId: string): TE.TaskEither<ViewError, GraphDelta> =>
    pipe(
        // Step 1: Fetch manifest
        TE.tryCatch(
            () => fetchManifest(baseUrl, shareId),
            toViewError(shareId)
        ),
        // Step 2: Parallel fetch files + positions (TE.apS pattern)
        TE.chain((manifest: ShareManifest) =>
            pipe(
                TE.tryCatch(
                    () => fetchFiles(baseUrl, shareId, manifest.files),
                    toViewError(shareId)
                ),
                TE.bindTo('files'),
                TE.apS('positions', TE.tryCatch(
                    () => fetchPositions(baseUrl, shareId),
                    toViewError(shareId)
                ))
            )
        ),
        // Step 3-5: Pure transformations — build graph, merge positions, convert to delta
        TE.map(({ files, positions }: {
            files: ReadonlyMap<string, string>,
            positions: ReadonlyMap<string, Position>
        }) => {
            const graph: Graph = buildGraphFromFiles(files)
            const withPositions: Graph = mergePositionsIntoGraph(graph, positions as ReadonlyMap<NodeIdAndFilePath, Position>)
            return mapNewGraphToDelta(withPositions)
        })
    )
