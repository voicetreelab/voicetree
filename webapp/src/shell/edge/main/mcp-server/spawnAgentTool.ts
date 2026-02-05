/**
 * MCP Tool: spawn_agent
 * Spawns an agent in the Voicetree graph.
 */

import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position} from '@/pure/graph'
import {findBestMatchingNode} from '@/pure/graph/markdown-parsing/extract-edges'
import {createTaskNode} from '@/pure/graph/graph-operations/createTaskNode'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getWritePath} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange'
import {spawnTerminalWithContextNode} from '@/shell/edge/main/terminals/spawnTerminalWithContextNode'
import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {type McpToolResponse, buildJsonResponse} from './types'

export interface SpawnAgentParams {
    nodeId?: string
    callerTerminalId: string
    task?: string
    details?: string
    parentNodeId?: string
    spawnDirectory?: string
}

export async function spawnAgentTool({nodeId, callerTerminalId, task, details, parentNodeId, spawnDirectory}: SpawnAgentParams): Promise<McpToolResponse> {
    //console.log(`[MCP] spawn_agent called by terminal: ${callerTerminalId}`)

    // Validate caller terminal exists
    // BUG: Currently fails for valid terminals because renderer's TerminalStore and main's
    // terminal-registry are separate registries that can get out of sync. The planned fix
    // (openspec: consolidate-terminal-registry) makes terminal-registry the single source
    // of truth. If this guard still fails after that change, remove it entirely.
    const terminalRecords: TerminalRecord[] = getTerminalRecords()
    const callerExists: boolean = terminalRecords.some(
        (record: TerminalRecord) => record.terminalId === callerTerminalId
    )
    if (!callerExists) {
        return buildJsonResponse({
            success: false,
            error: `Unknown caller terminal: ${callerTerminalId}`
        }, true)
    }

    const vaultPathOpt: O.Option<string> = await getWritePath()
    if (O.isNone(vaultPathOpt)) {
        return buildJsonResponse({
            success: false,
            error: 'No vault loaded. Please load a folder in the UI first.'
        }, true)
    }
    const writePath: string = vaultPathOpt.value

    const graph: Graph = getGraph()

    // Branch: If task is provided, create a new task node first
    if (task) {
        // Validate parentNodeId is required when task is provided
        if (!parentNodeId) {
            return buildJsonResponse({
                success: false,
                error: 'parentNodeId is required when task is provided'
            }, true)
        }

        // Resolve parent node
        const resolvedParentId: NodeIdAndFilePath | undefined = graph.nodes[parentNodeId]
            ? parentNodeId
            : findBestMatchingNode(parentNodeId, graph.nodes, graph.nodeByBaseName)

        if (!resolvedParentId || !graph.nodes[resolvedParentId]) {
            return buildJsonResponse({
                success: false,
                error: `Parent node ${parentNodeId} not found.`
            }, true)
        }

        const parentNode: GraphNode = graph.nodes[resolvedParentId]

        // Compute position near parent node
        const parentPosition: Position = O.getOrElse(() => ({x: 0, y: 0}))(parentNode.nodeUIMetadata.position)
        const taskNodePosition: Position = {
            x: parentPosition.x + 200,
            y: parentPosition.y + 100
        }

        // Build task description: title with optional details
        const taskDescription: string = details ? `${task}\n\n${details}` : task

        try {
            // Create task node
            const taskNodeDelta: GraphDelta = createTaskNode({
                taskDescription,
                selectedNodeIds: [resolvedParentId],
                graph,
                writePath,
                position: taskNodePosition
            })

            // Extract task node ID from delta
            const taskNodeId: NodeIdAndFilePath = taskNodeDelta[0].type === 'UpsertNode'
                ? taskNodeDelta[0].nodeToUpsert.absoluteFilePathIsID
                : '' as NodeIdAndFilePath

            if (!taskNodeId) {
                return buildJsonResponse({
                    success: false,
                    error: 'Failed to create task node'
                }, true)
            }

            // Apply task node to graph
            await applyGraphDeltaToDBThroughMemAndUIAndEditors(taskNodeDelta)

            // Spawn terminal on the new task node (with parent terminal for tree-style tabs)
            const {terminalId, contextNodeId}: {terminalId: string; contextNodeId: string} =
                await spawnTerminalWithContextNode(taskNodeId, undefined, undefined, true, false, undefined, spawnDirectory, callerTerminalId)

            return buildJsonResponse({
                success: true,
                terminalId,
                taskNodeId,
                contextNodeId,
                message: `Created task node and spawned agent for "${task}"`
            })
        } catch (error) {
            const errorMessage: string = error instanceof Error ? error.message : String(error)
            return buildJsonResponse({
                success: false,
                error: errorMessage
            }, true)
        }
    }

    // Original behavior: spawn on existing node
    if (!nodeId) {
        return buildJsonResponse({
            success: false,
            error: 'Either nodeId or task (with parentNodeId) must be provided'
        }, true)
    }

    // Resolve nodeId: support both full absolute paths and short names (e.g., "fix-test.md")
    // First try direct lookup, then fall back to findBestMatchingNode for short names
    const resolvedNodeId: NodeIdAndFilePath | undefined = graph.nodes[nodeId]
        ? nodeId
        : findBestMatchingNode(nodeId, graph.nodes, graph.nodeByBaseName)

    if (!resolvedNodeId || !graph.nodes[resolvedNodeId]) {
        return buildJsonResponse({
            success: false,
            error: `Node ${nodeId} not found.`
        }, true)
    }

    try {
        // Pass skipFitAnimation: true for MCP spawns to avoid interrupting user's viewport
        // Pass callerTerminalId as parentTerminalId for tree-style tabs
        const {terminalId, contextNodeId}: {terminalId: string; contextNodeId: string} =
            await spawnTerminalWithContextNode(resolvedNodeId, undefined, undefined, true, false, undefined, spawnDirectory, callerTerminalId)

        return buildJsonResponse({
            success: true,
            terminalId,
            nodeId: resolvedNodeId,
            contextNodeId,
            message: `Spawned agent for node ${resolvedNodeId}`
        })
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: errorMessage
        }, true)
    }
}
