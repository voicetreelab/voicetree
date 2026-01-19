/**
 * Orchestrator for "Run Agent on Selected Nodes" feature.
 *
 * Flow:
 * 1. Creates task node with user description + wikilinks to selected nodes
 * 2. Creates context node containing selected nodes
 * 3. Spawns agent terminal attached to task node
 */

import type { Graph, GraphDelta, NodeIdAndFilePath, Position } from '@/pure/graph'
import { getGraph } from '@/shell/edge/main/state/graph-store'
import { getWritePath } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { createTaskNode } from '@/pure/graph/graph-operations/createTaskNode'
import { createContextNodeFromSelectedNodes } from '@/shell/edge/main/graph/context-nodes/createContextNodeFromSelectedNodes'
import { spawnTerminalWithContextNode } from '@/shell/edge/main/terminals/spawnTerminalWithContextNode'
import {
  applyGraphDeltaToDBThroughMemAndUIAndEditors
} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange'
import * as O from 'fp-ts/lib/Option.js'

export interface RunAgentOnSelectedParams {
  readonly selectedNodeIds: readonly NodeIdAndFilePath[]
  readonly taskDescription: string
  readonly position: Position
}

export interface RunAgentOnSelectedResult {
  readonly taskNodeId: NodeIdAndFilePath
  readonly contextNodeId: NodeIdAndFilePath
  readonly terminalId: string
}

/**
 * Creates task node, context node, and spawns agent terminal for selected nodes.
 *
 * @param params - Parameters including selected nodes, task description, and position
 * @returns IDs of created task node, context node, and terminal
 */
export async function runAgentOnSelectedNodes(
  params: RunAgentOnSelectedParams
): Promise<RunAgentOnSelectedResult> {
  const { selectedNodeIds, taskDescription, position } = params

  if (selectedNodeIds.length === 0) {
    throw new Error('No nodes selected')
  }

  // Get current graph and write path
  const graph: Graph = getGraph()
  const writePathOption: O.Option<string> = await getWritePath()
  const writePath: string = O.getOrElse(() => '')(writePathOption)

  // 1. Create task node
  const taskNodeDelta: GraphDelta = createTaskNode({
    taskDescription,
    selectedNodeIds,
    graph,
    writePath,
    position
  })

  // Extract task node ID from delta
  const taskNodeId: NodeIdAndFilePath = taskNodeDelta[0].type === 'UpsertNode'
    ? taskNodeDelta[0].nodeToUpsert.absoluteFilePathIsID
    : '' as NodeIdAndFilePath

  if (!taskNodeId) {
    throw new Error('Failed to create task node')
  }

  // Apply task node to graph
  await applyGraphDeltaToDBThroughMemAndUIAndEditors(taskNodeDelta)

  // 2. Create context node from selected nodes
  const contextNodeId: NodeIdAndFilePath = await createContextNodeFromSelectedNodes(
    taskNodeId,
    selectedNodeIds
  )

  // 3. Spawn terminal with context node
  // The terminal will be anchored to the task node (found via context node's parent)
  const result: { terminalId: string; contextNodeId: NodeIdAndFilePath } =
    await spawnTerminalWithContextNode(
      contextNodeId,
      undefined, // Use default agent command
      undefined, // Auto-assign terminal count
      false,     // Don't skip fit animation
      false      // Start pinned
    )

  return {
    taskNodeId,
    contextNodeId,
    terminalId: result.terminalId
  }
}
