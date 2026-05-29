/**
 * Positions I/O: reads/writes node positions to `.voicetree/positions.json`.
 *
 * Positions are stored separately from markdown content so dragging nodes
 * doesn't produce noisy git diffs against the .md files. The file lives at
 * `{projectRoot}/.voicetree/positions.json` and maps absolute node IDs to
 * `{x, y}` coordinates.
 *
 * Exported as a single deep-function bundle `positionsIO` so the shared
 * boundary with consumers is one symbol, not two — deps and intermediate
 * helpers stay private to this module.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import * as path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, Position, NodeIdAndFilePath } from '@vt/graph-model/graph'
import {getProjectDotVoicetreePath} from '../paths.ts'

interface PositionsFile {
    readonly [nodeId: string]: { readonly x: number; readonly y: number }
}

function positionsFilePath(projectRoot: string): string {
    return path.join(getProjectDotVoicetreePath(projectRoot), 'positions.json')
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

async function loadPositions(projectRoot: string): Promise<ReadonlyMap<NodeIdAndFilePath, Position>> {
    const filePath: string = positionsFilePath(projectRoot)
    try {
        const data: string = await readFile(filePath, 'utf-8')
        return new Map(entriesFromPositions(decodePositions(data)))
    } catch {
        return new Map()
    }
}

function savePositionsSync(graph: Graph, projectRoot: string): void {
    const positions: PositionsFile = projectGraphPositions(graph)
    const filePath: string = positionsFilePath(projectRoot)
    const dir: string = path.dirname(filePath)

    if (Object.keys(positions).length === 0) {
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
    writeFileSync(filePath, JSON.stringify(positions, null, 2), 'utf-8')
}

/**
 * Public bundle for positions I/O. One symbol crosses the package
 * boundary — `positionsIO` — so consumers don't widen their import
 * count for related ops.
 */
export const positionsIO = {
    load: loadPositions,
    save: savePositionsSync,
} as const
