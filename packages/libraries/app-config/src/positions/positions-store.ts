/**
 * Positions store: reads/writes node positions to .voicetree/positions.json
 *
 * Positions are stored separately from markdown files to avoid noisy git diffs.
 * The positions file lives at {projectRoot}/.voicetree/positions.json and maps
 * absolute node IDs to {x, y} coordinates.
 *
 * Migration: positions still parsed from YAML frontmatter as fallback.
 * The in-memory position-preservation in applyGraphDeltaToGraph handles
 * the case where re-parsed nodes lack YAML positions.
 */

import * as fs from 'fs'
import { promises as fsAsync } from 'fs'
import * as path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, Position, NodeIdAndFilePath } from '@vt/graph-model/graph'
export { mergePositionsIntoGraph } from '@vt/graph-model/spatial'

interface PositionsFile {
    readonly [nodeId: string]: { readonly x: number; readonly y: number }
}

function positionsFilePath(projectRoot: string): string {
    return path.join(projectRoot, '.voicetree', 'positions.json')
}

function decodePositions(raw: string): PositionsFile {
    return JSON.parse(raw) as PositionsFile
}

function entriesFromPositions(parsed: PositionsFile): readonly [NodeIdAndFilePath, Position][] {
    return Object.entries(parsed)
        .filter(([, pos]) => typeof pos.x === 'number' && typeof pos.y === 'number')
        .map(([nodeId, pos]) => [nodeId, { x: pos.x, y: pos.y }] as [NodeIdAndFilePath, Position])
}

function projectGraphPositions(graph: Graph): PositionsFile {
    return Object.entries(graph.nodes).reduce(
        (acc: PositionsFile, [nodeId, node]: [string, GraphNode]) => {
            if (O.isSome(node.nodeUIMetadata.position)) {
                return { ...acc, [nodeId]: { x: Math.round(node.nodeUIMetadata.position.value.x), y: Math.round(node.nodeUIMetadata.position.value.y) } }
            }
            return acc
        },
        {}
    )
}

/**
 * Load positions from .voicetree/positions.json.
 * Returns empty map if file doesn't exist or is invalid.
 */
export async function loadPositions(projectRoot: string): Promise<ReadonlyMap<NodeIdAndFilePath, Position>> {
    const filePath: string = positionsFilePath(projectRoot)
    try {
        const data: string = await fsAsync.readFile(filePath, 'utf-8')
        return new Map(entriesFromPositions(decodePositions(data)))
    } catch {
        return new Map()
    }
}

/**
 * Save all node positions from graph to .voicetree/positions.json.
 * Synchronous variant for use on app exit.
 *
 * Skips the write when the projected graph has no positions but the
 * existing on-disk file does — this guards against wiping persisted
 * positions during early-exit before the graph has loaded.
 */
export function savePositionsSync(graph: Graph, projectRoot: string): void {
    const positions: PositionsFile = projectGraphPositions(graph)
    const filePath: string = positionsFilePath(projectRoot)
    const dir: string = path.dirname(filePath)

    if (Object.keys(positions).length === 0) {
        let existing: string | null = null
        try {
            existing = fs.readFileSync(filePath, 'utf-8')
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

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(positions, null, 2), 'utf-8')
}
