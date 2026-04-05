/**
 * MCP Tool: spawn_agent
 * Spawns an agent in the Voicetree graph.
 */

import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position} from '@vt/graph-model/pure/graph'
import {findBestMatchingNode} from '@vt/graph-model/pure/graph/markdown-parsing/extract-edges'
import {createTaskNode} from '@vt/graph-model/pure/graph/graph-operations/createTaskNode'
import {calculateNodePosition} from '@vt/graph-model/pure/graph/positioning/calculateInitialPosition'
import {buildSpatialIndexFromGraph} from '@vt/graph-model/pure/graph/positioning/spatialAdapters'
import type {SpatialIndex} from '@vt/graph-model/pure/graph/spatial'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getWritePath} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange'
import {spawnTerminalWithContextNode} from '@/shell/edge/main/terminals/spawnTerminalWithContextNode'
import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {tryConsumeAndSplitBudget, registerChild} from '@/shell/edge/main/terminals/global-budget-registry'
import {loadSettings} from '@/shell/edge/main/settings/settings_IO'
import type {VTSettings} from '@vt/graph-model/pure/settings'
import {type McpToolResponse, buildJsonResponse} from './types'
import {startMonitor} from './agent-completion-monitor'

export interface SpawnAgentParams {
    nodeId?: string
    callerTerminalId: string
    task?: string
    parentNodeId?: string
    spawnDirectory?: string
    promptTemplate?: string
    agentName?: string
    headless?: boolean
    replaceSelf?: boolean
    depthBudget?: number
}

export async function spawnAgentTool({nodeId, callerTerminalId, task, parentNodeId, spawnDirectory, promptTemplate, agentName, headless, replaceSelf, depthBudget}: SpawnAgentParams): Promise<McpToolResponse> {
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

    // Compute child's DEPTH_BUDGET: explicit override > auto-decrement from parent
    const callerRecord: TerminalRecord | undefined = terminalRecords.find(
        (r: TerminalRecord) => r.terminalId === callerTerminalId
    )
    let childDepthBudget: number | undefined
    if (depthBudget !== undefined) {
        childDepthBudget = depthBudget
    } else if (callerRecord?.terminalData.initialEnvVars?.DEPTH_BUDGET) {
        const parentBudget: number = parseInt(callerRecord.terminalData.initialEnvVars.DEPTH_BUDGET, 10)
        if (!isNaN(parentBudget)) {
            childDepthBudget = Math.max(0, parentBudget - 1)
        }
    }

    // Check global spawn budget before proceeding (fair rebalancing: splits caller's budget among siblings)
    const budgetResult: { allowed: boolean; childBudget: number | undefined } = tryConsumeAndSplitBudget(callerTerminalId)
    if (!budgetResult.allowed) {
        return buildJsonResponse({
            success: false,
            error: 'Global spawn budget exhausted'
        }, true)
    }

    // Build env overrides: DEPTH_BUDGET + GLOBAL_SPAWN_BUDGET (child's allocated share)
    const envOverrides: Record<string, string> = {
        ...(childDepthBudget !== undefined ? {DEPTH_BUDGET: String(childDepthBudget)} : {}),
        ...(budgetResult.childBudget !== undefined ? {GLOBAL_SPAWN_BUDGET: String(budgetResult.childBudget)} : {}),
    }

    // Validate replaceSelf constraints
    if (replaceSelf && !callerRecord) {
        return buildJsonResponse({
            success: false,
            error: 'replaceSelf requires a valid caller terminal'
        }, true)
    }

    // Resolve agentName to a command from settings.agents.
    // If no agentName is provided, inherit the caller's configured agent type.
    let resolvedAgentCommand: string | undefined
    const callerAgentTypeName: string | undefined = callerRecord?.terminalData.agentTypeName
    if (agentName || callerAgentTypeName) {
        const settings: VTSettings = await loadSettings()
        const agents: readonly { readonly name: string; readonly command: string }[] = settings?.agents ?? []
        if (agentName) {
            const matchedAgent: { readonly name: string; readonly command: string } | undefined =
                agents.find((a: { readonly name: string; readonly command: string }) => a.name === agentName)
            if (!matchedAgent) {
                return buildJsonResponse({
                    success: false,
                    error: `Agent "${agentName}" not found in settings.agents. Available: ${agents.map((a: { readonly name: string; readonly command: string }) => a.name).join(', ')}`
                }, true)
            }
            resolvedAgentCommand = matchedAgent.command
        } else if (callerAgentTypeName) {
            resolvedAgentCommand = agents.find(
                (a: { readonly name: string; readonly command: string }) => a.name === callerAgentTypeName
            )?.command
        }
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

        // Compute position near parent node using unified collision-aware placement
        const spatialIndex: SpatialIndex = buildSpatialIndexFromGraph(graph)
        const taskNodePosition: Position = O.getOrElse(() => ({x: 0, y: 0}))(calculateNodePosition(graph, spatialIndex, resolvedParentId))

        const taskDescription: string = task

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

            // Mark task node as claimed
            const freshGraph: Graph = getGraph()
            const freshTaskNode: GraphNode | undefined = freshGraph.nodes[taskNodeId]
            if (freshTaskNode) {
                const claimedYAML: Map<string, string> = new Map([
                    ...freshTaskNode.nodeUIMetadata.additionalYAMLProps,
                    ['status', 'claimed']
                ])
                const claimDelta: GraphDelta = [{
                    type: 'UpsertNode',
                    nodeToUpsert: {
                        ...freshTaskNode,
                        nodeUIMetadata: {
                            ...freshTaskNode.nodeUIMetadata,
                            additionalYAMLProps: claimedYAML
                        }
                    },
                    previousNode: O.some(freshTaskNode)
                }]
                await applyGraphDeltaToDBThroughMemAndUIAndEditors(claimDelta)
            }

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
            // When replaceSelf, the successor inherits the caller's terminal ID and its parent
            // (not the caller itself as parent — that would create a self-referential cycle)
            const replaceSelfParentId: string | undefined = replaceSelf
                ? (callerRecord?.terminalData.parentTerminalId ?? undefined)
                : callerTerminalId
            const {terminalId, contextNodeId}: {terminalId: string; contextNodeId: string} =
                await spawnTerminalWithContextNode(taskNodeId, resolvedAgentCommand, undefined, true, false, undefined, resolvedSpawnDirectory, replaceSelfParentId, promptTemplate, headless, replaceSelf ? callerTerminalId : undefined, envOverrides)

            if (!replaceSelf) {
                registerChild(callerTerminalId, terminalId)
                startMonitor(callerTerminalId, [terminalId], 5000)
            }

            return buildJsonResponse({
                success: true,
                terminalId,
                taskNodeId,
                contextNodeId,
                depthBudget: childDepthBudget,
                message: replaceSelf
                    ? `Replaced self — successor agent running as "${terminalId}"`
                    : `Created task node and spawned agent for "${task}". You will be notified when the agent completes.`
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
        // Mark existing node as claimed
        const targetNode: GraphNode | undefined = graph.nodes[resolvedNodeId]
        if (targetNode) {
            const claimedYAML: Map<string, string> = new Map([
                ...targetNode.nodeUIMetadata.additionalYAMLProps,
                ['status', 'claimed']
            ])
            const claimDelta: GraphDelta = [{
                type: 'UpsertNode',
                nodeToUpsert: {
                    ...targetNode,
                    nodeUIMetadata: {
                        ...targetNode.nodeUIMetadata,
                        additionalYAMLProps: claimedYAML
                    }
                },
                previousNode: O.some(targetNode)
            }]
            await applyGraphDeltaToDBThroughMemAndUIAndEditors(claimDelta)
        }

        // Pass skipFitAnimation: true for MCP spawns to avoid interrupting user's viewport
        // Pass callerTerminalId as parentTerminalId for tree-style tabs
        // When replaceSelf, successor inherits caller's parent (not itself as parent — avoids cycle)
        const replaceSelfParentId2: string | undefined = replaceSelf
            ? (callerRecord?.terminalData.parentTerminalId ?? undefined)
            : callerTerminalId
        const {terminalId, contextNodeId}: {terminalId: string; contextNodeId: string} =
            await spawnTerminalWithContextNode(resolvedNodeId, resolvedAgentCommand, undefined, true, false, undefined, resolvedSpawnDirectory, replaceSelfParentId2, promptTemplate, headless, replaceSelf ? callerTerminalId : undefined, envOverrides)

        if (!replaceSelf) {
            registerChild(callerTerminalId, terminalId)
            startMonitor(callerTerminalId, [terminalId], 5000)
        }

        return buildJsonResponse({
            success: true,
            terminalId,
            nodeId: resolvedNodeId,
            contextNodeId,
            depthBudget: childDepthBudget,
            message: replaceSelf
                ? `Replaced self — successor agent running as "${terminalId}"`
                : `Spawned agent for node ${resolvedNodeId}. You will be notified when the agent completes.`
        })
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: errorMessage
        }, true)
    }
}
