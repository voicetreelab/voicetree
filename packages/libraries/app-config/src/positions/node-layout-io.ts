/**
 * Node-layout I/O: reads/writes node spatial layout to
 * `.voicetree/node-layout.json`.
 *
 * ONE source of truth for all spatial layout. Position and size are the same
 * kind of thing — drag-driven canvas layout — so they share a single sidecar
 * with one record per node: `{ x?, y?, w?, h? }`. Keeping layout out of the
 * markdown content avoids noisy git diffs and write-contention with the editor
 * autosave; keeping it in ONE file (not two sidecars, not frontmatter) means
 * position and size can never drift across stores.
 *
 * The file lives at `{projectRoot}/.voicetree/node-layout.json` and maps
 * absolute node IDs to layout records. graphd is the sole writer.
 *
 * Exported as a single deep-function bundle `nodeLayoutIO` so the shared
 * boundary with consumers is one symbol — deps and intermediate helpers stay
 * private to this module.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import * as path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, NodeLayout, NodeIdAndFilePath } from '@vt/graph-model/graph'
import { getProjectDotVoicetreePath } from '@vt/paths'

/** One persisted record. All fields optional — a node may carry position, size, or both. */
interface NodeLayoutRecord {
    readonly x?: number
    readonly y?: number
    readonly w?: number
    readonly h?: number
}

interface NodeLayoutFile {
    readonly [nodeId: string]: NodeLayoutRecord
}

function nodeLayoutFilePath(projectRoot: string): string {
    return path.join(getProjectDotVoicetreePath(projectRoot), 'node-layout.json')
}

function decodeNodeLayout(raw: string): NodeLayoutFile {
    return JSON.parse(raw) as NodeLayoutFile
}

/** Project a persisted record into the in-memory NodeLayout shape, dropping malformed fields. */
function recordToNodeLayout(record: NodeLayoutRecord): NodeLayout {
    const hasPosition: boolean = typeof record.x === 'number' && typeof record.y === 'number'
    const hasSize: boolean = typeof record.w === 'number' && typeof record.h === 'number'
    return {
        ...(hasPosition ? { position: { x: record.x as number, y: record.y as number } } : {}),
        ...(hasSize ? { size: { width: record.w as number, height: record.h as number } } : {}),
    }
}

function entriesFromFile(parsed: NodeLayoutFile): readonly [NodeIdAndFilePath, NodeLayout][] {
    return Object.entries(parsed)
        .map(([nodeId, record]) => [nodeId, recordToNodeLayout(record)] as [NodeIdAndFilePath, NodeLayout])
        // Drop entries that decoded to nothing (no valid position and no valid size).
        .filter(([, layout]) => layout.position !== undefined || layout.size !== undefined)
}

/** Build a persisted record from a node's spatial metadata, or undefined if it has neither. */
function nodeToRecord(node: GraphNode): NodeLayoutRecord | undefined {
    const position: O.Option<{ x: number; y: number }> = node.nodeUIMetadata.position
    const size: O.Option<{ width: number; height: number }> = node.nodeUIMetadata.size ?? O.none
    const positionPart: NodeLayoutRecord = O.isSome(position)
        ? { x: Math.round(position.value.x), y: Math.round(position.value.y) }
        : {}
    const sizePart: NodeLayoutRecord = O.isSome(size)
        ? { w: Math.round(size.value.width), h: Math.round(size.value.height) }
        : {}
    if (O.isNone(position) && O.isNone(size)) return undefined
    return { ...positionPart, ...sizePart }
}

function projectGraphLayout(graph: Graph): NodeLayoutFile {
    return Object.entries(graph.nodes).reduce(
        (acc: NodeLayoutFile, [nodeId, node]: [string, GraphNode]) => {
            const record: NodeLayoutRecord | undefined = nodeToRecord(node)
            return record ? { ...acc, [nodeId]: record } : acc
        },
        {},
    )
}

async function loadNodeLayout(projectRoot: string): Promise<ReadonlyMap<NodeIdAndFilePath, NodeLayout>> {
    const filePath: string = nodeLayoutFilePath(projectRoot)
    try {
        const data: string = await readFile(filePath, 'utf-8')
        return new Map(entriesFromFile(decodeNodeLayout(data)))
    } catch {
        return new Map()
    }
}

function saveNodeLayoutSync(graph: Graph, projectRoot: string): void {
    const layout: NodeLayoutFile = projectGraphLayout(graph)
    const filePath: string = nodeLayoutFilePath(projectRoot)
    const dir: string = path.dirname(filePath)

    // Never clobber a populated sidecar with an empty projection: a transiently
    // empty in-memory graph (e.g. mid-reload) must not wipe persisted layout.
    if (Object.keys(layout).length === 0) {
        let existing: string | null = null
        try {
            existing = readFileSync(filePath, 'utf-8')
        } catch {
            existing = null
        }
        if (existing !== null) {
            try {
                const parsed: unknown = JSON.parse(existing)
                if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
                    return
                }
            } catch {
                // corrupt file — fall through and overwrite
            }
        }
    }

    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
    }
    writeFileSync(filePath, JSON.stringify(layout, null, 2), 'utf-8')
}

/**
 * Public bundle for node-layout I/O. One symbol crosses the package
 * boundary — `nodeLayoutIO` — so consumers don't widen their import count
 * for related ops.
 */
export const nodeLayoutIO = {
    load: loadNodeLayout,
    save: saveNodeLayoutSync,
} as const
