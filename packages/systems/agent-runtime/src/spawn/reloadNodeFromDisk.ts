import { promises as fs } from 'fs'
import type {FSUpdate, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {addNodeToGraphWithEdgeHealingFromFSEvent, applyGraphDeltaToGraph} from '@vt/graph-model/graph'
import {
    getRuntimeGraph,
    runtimeRefreshGraphSideEffects,
    setRuntimeGraph,
} from '../runtime/graph-bridge'

export type SpawnTerminalLogger = {
    error(message?: unknown, ...optionalParams: unknown[]): void
    warn(message?: unknown, ...optionalParams: unknown[]): void
}

export type SpawnTerminalDeps = {
    readTextFile(filePath: string): Promise<string>
    logger: SpawnTerminalLogger
}

export const defaultSpawnTerminalDeps: SpawnTerminalDeps = {
    readTextFile: (filePath: string): Promise<string> => fs.readFile(filePath, 'utf-8'),
    logger: { error: console.error, warn: console.warn },
}

/**
 * Self-healing: attempt to load a node from disk when it exists as a file
 * but is missing from the in-memory graph.
 *
 * This handles edge cases where the graph state gets out of sync with the
 * filesystem (race conditions during loading, skipped watcher events, etc.).
 *
 * Returns the loaded GraphNode, or undefined if the file doesn't exist.
 */
export async function tryReloadNodeFromDisk(
    nodeId: NodeIdAndFilePath,
    deps: Pick<SpawnTerminalDeps, 'readTextFile' | 'logger'> = defaultSpawnTerminalDeps,
): Promise<GraphNode | undefined> {
    const filePath: string = nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`
    try {
        const content: string = await deps.readTextFile(filePath)
        const fsEvent: FSUpdate = { absolutePath: filePath, content, eventType: 'Added' }
        const graph = getRuntimeGraph()
        const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, graph)
        if (delta.length === 0) return undefined
        const newGraph = applyGraphDeltaToGraph(graph, delta)
        setRuntimeGraph(newGraph)
        runtimeRefreshGraphSideEffects()
        deps.logger.warn(`[spawnTerminal] Self-healed missing node from disk: ${nodeId}`)
        return newGraph.nodes[nodeId]
    } catch {
        return undefined
    }
}
