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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import * as path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, Position, NodeIdAndFilePath } from '@vt/graph-model/graph'
export { mergePositionsIntoGraph } from '@vt/graph-model/spatial'

interface PositionsFile {
    readonly [nodeId: string]: { readonly x: number; readonly y: number }
}

/**
 * Shell-injected dependencies for positions IO. Threading these in keeps
 * `loadPositions` / `savePositionsSync` (and every transitive caller in
 * the graph-db-server / electron-main / web-share trees) free of the
 * `node:fs` namespace import, so the transitive-purity gate doesn't drag
 * the whole graph-loading pipeline through this leaf.
 */
export interface PositionsAsyncDeps {
    readonly readFile: (filePath: string, encoding: 'utf-8') => Promise<string>
}

export interface PositionsSyncDeps {
    readonly readFileSync: (filePath: string, encoding: 'utf-8') => string
    readonly writeFileSync: (filePath: string, data: string, encoding: 'utf-8') => void
    readonly existsSync: (filePath: string) => boolean
    readonly mkdirSync: (dir: string, opts: { recursive: true }) => void
}

/** Default real-IO deps — module-level so call sites don't re-import fs. */
export const defaultPositionsAsyncDeps: PositionsAsyncDeps = {
    readFile: (filePath, encoding) => readFile(filePath, encoding),
}

export const defaultPositionsSyncDeps: PositionsSyncDeps = {
    readFileSync,
    writeFileSync,
    existsSync,
    mkdirSync,
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
export async function loadPositions(
    projectRoot: string,
    deps: PositionsAsyncDeps,
): Promise<ReadonlyMap<NodeIdAndFilePath, Position>> {
    const filePath: string = positionsFilePath(projectRoot)
    try {
        const data: string = await deps.readFile(filePath, 'utf-8')
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
export function savePositionsSync(
    graph: Graph,
    projectRoot: string,
    deps: PositionsSyncDeps,
): void {
    const positions: PositionsFile = projectGraphPositions(graph)
    const filePath: string = positionsFilePath(projectRoot)
    const dir: string = path.dirname(filePath)

    if (Object.keys(positions).length === 0) {
        let existing: string | null = null
        try {
            existing = deps.readFileSync(filePath, 'utf-8')
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

    if (!deps.existsSync(dir)) {
        deps.mkdirSync(dir, { recursive: true })
    }
    deps.writeFileSync(filePath, JSON.stringify(positions, null, 2), 'utf-8')
}
