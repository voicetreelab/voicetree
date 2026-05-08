/**
 * Resolve a user-supplied node ID to a real node in the graph store, with a
 * disk fallback when the in-memory graph is briefly out of sync with the
 * vault filesystem.
 *
 * Why this exists: every MCP tool that takes a `nodeId` / `parentNodeId` does
 * the same three-step lookup:
 *   1. Direct key match against `graph.nodes`.
 *   2. Suffix/basename match via `findBestMatchingNode` (handles short names).
 *   3. If both miss but the path resolves to a real `.md` file on disk, ingest
 *      that file into the in-memory graph and return the resolved ID.
 *
 * Step 3 closes a real bug: when a node was just written by `create_graph` or
 * `spawn_agent` but a follow-up MCP call sees an in-memory graph that doesn't
 * yet know about it, the tool used to short-circuit with "Node ... not found"
 * even though `spawnTerminalWithContextNode` already had identical disk-
 * fallback logic further downstream. Centralising the fallback here means
 * every entrypoint behaves the same way, and the agent gets a successful
 * call instead of a misleading error and a wasted retry loop.
 */

import {promises as fs} from 'fs'
import path from 'path'
import {
    addNodeToGraphWithEdgeHealingFromFSEvent,
    applyGraphDeltaToGraph,
    type FSUpdate,
    type Graph,
    type GraphDelta,
    type NodeIdAndFilePath,
} from '@vt/graph-model/graph'
import {findBestMatchingNode} from '@vt/graph-model/markdown'
import {getGraph, setGraph} from '../state/graph-store'
import {broadcastGraphDeltaToUI} from './applyGraphDelta'

async function readFileIfExists(filePath: string): Promise<string | undefined> {
    try {
        return await fs.readFile(filePath, 'utf-8')
    } catch {
        return undefined
    }
}

async function adoptOnDiskNodeIntoGraph(nodeId: NodeIdAndFilePath): Promise<NodeIdAndFilePath | undefined> {
    if (!path.isAbsolute(nodeId)) return undefined
    const filePath: string = nodeId.endsWith('.md') ? nodeId : `${nodeId}.md`
    const content: string | undefined = await readFileIfExists(filePath)
    if (content === undefined) return undefined

    const graph: Graph = getGraph()
    const fsEvent: FSUpdate = {absolutePath: filePath, content, eventType: 'Added'}
    const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, graph)
    if (delta.length === 0) return undefined

    const newGraph: Graph = applyGraphDeltaToGraph(graph, delta)
    setGraph(newGraph)
    broadcastGraphDeltaToUI(delta)
    return newGraph.nodes[filePath] !== undefined ? (filePath as NodeIdAndFilePath) : undefined
}

/**
 * Resolve a node ID against the in-memory graph; if it isn't there, try
 * suffix/basename match; if that misses too, ingest the file from disk.
 *
 * @returns the resolved node ID (now guaranteed to be a key in `getGraph().nodes`),
 *          or undefined if no match exists in memory or on disk.
 */
export async function resolveNodeFromGraphOrDisk(
    nodeIdOrPath: string,
): Promise<NodeIdAndFilePath | undefined> {
    const graph: Graph = getGraph()

    if (graph.nodes[nodeIdOrPath]) return nodeIdOrPath as NodeIdAndFilePath

    const matched: NodeIdAndFilePath | undefined = findBestMatchingNode(
        nodeIdOrPath, graph.nodes, graph.nodeByBaseName,
    )
    if (matched && getGraph().nodes[matched]) return matched

    return adoptOnDiskNodeIntoGraph(nodeIdOrPath as NodeIdAndFilePath)
}
