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
import {loadSettings} from '@/shell/edge/main/settings/settings_IO'
import type {VTSettings} from '@/pure/settings'
import {type McpToolResponse, buildJsonResponse} from './types'

export interface SpawnAgentParams {
    nodeId?: string
    callerTerminalId: string
    task?: string
    details?: string
    parentNodeId?: string
    spawnDirectory?: string
    promptTemplate?: string
    agentName?: string
}

export async function spawnAgentTool({nodeId, callerTerminalId, task, details, parentNodeId, spawnDirectory, promptTemplate, agentName}: SpawnAgentParams): Promise<McpToolResponse> {
    //console.log(`[MCP] spawn_agent called by terminal: ${callerTerminalId}`)

    // Validate caller terminal exists
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

    // Resolve agentName to a command from settings.agents (if provided)
    let resolvedAgentCommand: string | undefined
    if (agentName) {
        const settings: VTSettings = await loadSettings()
        const agents: readonly { readonly name: string; readonly command: string }[] = settings?.agents ?? []
        const matchedAgent: { readonly name: string; readonly command: string } | undefined =
            agents.find((a: { readonly name: string; readonly command: string }) => a.name === agentName)
        if (!matchedAgent) {
            return buildJsonResponse({
                success: false,
                error: `Agent "${agentName}" not found in settings.agents. Available: ${agents.map((a: { readonly name: string; readonly command: string }) => a.name).join(', ')}`
            }, true)
        }
        resolvedAgentCommand = matchedAgent.command
    }

    // Inherit spawnDirectory from caller terminal if not explicitly provided
    // This ensures child agents spawn in the same worktree as their parent
    const resolvedSpawnDirectory: string | undefined = spawnDirectory ?? (() => {
        const callerRecord: TerminalRecord | undefined = terminalRecords.find(
            (r: TerminalRecord) => r.terminalId === callerTerminalId
        )
        return callerRecord?.terminalData.initialSpawnDirectory
    })()

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

            // Update caller's context node to mark task node as "seen"
            const callerRecord: TerminalRecord | undefined = terminalRecords.find(
                (r: TerminalRecord) => r.terminalId === callerTerminalId
            )
            if (callerRecord) {
                const callerContextNodeId: string = callerRecord.terminalData.attachedToContextNodeId
                const updatedGraph: Graph = getGraph()
                const callerContextNode: GraphNode | undefined = updatedGraph.nodes[callerContextNodeId]
                if (callerContextNode?.nodeUIMetadata.containedNodeIds) {
                    const updatedContainedNodeIds: readonly string[] = [
                        ...callerContextNode.nodeUIMetadata.containedNodeIds,
                        taskNodeId
                    ]
                    const updatedContextNode: GraphNode = {
                        ...callerContextNode,
                        nodeUIMetadata: {
                            ...callerContextNode.nodeUIMetadata,
                            containedNodeIds: updatedContainedNodeIds
                        }
                    }
                    const updateDelta: GraphDelta = [{
                        type: 'UpsertNode',
                        nodeToUpsert: updatedContextNode,
                        previousNode: O.some(callerContextNode)
                    }]
                    await applyGraphDeltaToDBThroughMemAndUIAndEditors(updateDelta)
                }
            }

            // Spawn terminal on the new task node (with parent terminal for tree-style tabs)
            const {terminalId, contextNodeId}: {terminalId: string; contextNodeId: string} =
                await spawnTerminalWithContextNode(taskNodeId, resolvedAgentCommand, undefined, true, false, undefined, resolvedSpawnDirectory, callerTerminalId, undefined, promptTemplate)

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
            await spawnTerminalWithContextNode(resolvedNodeId, resolvedAgentCommand, undefined, true, false, undefined, resolvedSpawnDirectory, callerTerminalId, details, promptTemplate)

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
