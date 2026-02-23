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
import type { Graph, GraphNode, Position, NodeIdAndFilePath } from '@/pure/graph'

interface PositionsFile {
    readonly [nodeId: string]: { readonly x: number; readonly y: number }
}

function positionsFilePath(projectRoot: string): string {
    return path.join(projectRoot, '.voicetree', 'positions.json')
}

/**
 * Load positions from .voicetree/positions.json.
 * Returns empty map if file doesn't exist or is invalid.
 */
export async function loadPositions(projectRoot: string): Promise<ReadonlyMap<NodeIdAndFilePath, Position>> {
    const filePath: string = positionsFilePath(projectRoot)
    try {
        const data: string = await fsAsync.readFile(filePath, 'utf-8')
        const parsed: PositionsFile = JSON.parse(data) as PositionsFile
        const entries: [NodeIdAndFilePath, Position][] = Object.entries(parsed)
            .filter(([, pos]) => typeof pos.x === 'number' && typeof pos.y === 'number')
            .map(([nodeId, pos]) => [nodeId, { x: pos.x, y: pos.y }])
        return new Map(entries)
    } catch {
        return new Map()
    }
}

/**
 * Merge loaded positions into graph nodes.
 * JSON positions take priority over any YAML-sourced positions.
 * Nodes without a JSON position keep their YAML position (migration).
 */
export function mergePositionsIntoGraph(graph: Graph, positions: ReadonlyMap<NodeIdAndFilePath, Position>): Graph {
    if (positions.size === 0) return graph

    const updatedNodes: Record<string, GraphNode> = Object.entries(graph.nodes).reduce(
        (acc: Record<string, GraphNode>, [nodeId, node]: [string, GraphNode]) => {
            const pos: Position | undefined = positions.get(nodeId)
            if (pos) {
                return {
                    ...acc,
                    [nodeId]: {
                        ...node,
                        nodeUIMetadata: {
                            ...node.nodeUIMetadata,
                            position: O.some(pos)
                        }
                    }
                }
            }
            return { ...acc, [nodeId]: node }
        },
        {}
    )

    return {
        ...graph,
        nodes: updatedNodes
    }
}

/**
 * Save all node positions from graph to .voicetree/positions.json.
 * Synchronous variant for use on app exit.
 */
export function savePositionsSync(graph: Graph, projectRoot: string): void {
    const positions: PositionsFile = Object.entries(graph.nodes).reduce(
        (acc: PositionsFile, [nodeId, node]: [string, GraphNode]) => {
            if (O.isSome(node.nodeUIMetadata.position)) {
                return { ...acc, [nodeId]: { x: Math.round(node.nodeUIMetadata.position.value.x), y: Math.round(node.nodeUIMetadata.position.value.y) } }
            }
            return acc
        },
        {}
    )

    const filePath: string = positionsFilePath(projectRoot)
    const dir: string = path.dirname(filePath)

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(positions, null, 2), 'utf-8')
}
