/**
 * Orchestrator for "Run Agent on Selected Nodes" feature.
 *
 * Flow:
 * 1. Creates task node with user description + wikilinks to selected nodes
 * 2. Spawns agent terminal (which creates context node internally)
 */

import type { Graph, GraphDelta, NodeIdAndFilePath, Position } from '@vt/graph-model/graph'
import { getWriteFolder } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { createTaskNode } from '@vt/graph-model/graph'
import { spawnTerminalWithContextNode } from '@vt/vt-daemon-client'
import { getVtDaemonClient } from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import { getGraphFromDaemon, postDeltaThroughDaemonWithEditors } from '@/shell/edge/main/runtime/electron/daemon/ipc/daemon-ipc-proxy'
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
  const graph: Graph = await getGraphFromDaemon()
  const writeFolderOption: O.Option<string> = await getWriteFolder()
  const writeFolder: string = O.getOrElse(() => '')(writeFolderOption)

  // 1. Create task node
  const taskNodeDelta: GraphDelta = createTaskNode({
    taskDescription,
    selectedNodeIds,
    graph,
    writeFolder,
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
  await postDeltaThroughDaemonWithEditors(taskNodeDelta)

  // 2. Spawn terminal with task node and selected nodes
  // spawnTerminalWithContextNode creates the context node internally
  const result: { terminalId: string; contextNodeId: NodeIdAndFilePath } =
    await spawnTerminalWithContextNode(getVtDaemonClient(), {
      taskNodeId,
      skipFitAnimation: false,
      startUnpinned: false,
      selectedNodeIds,
    })

  return {
    taskNodeId,
    contextNodeId: result.contextNodeId,
    terminalId: result.terminalId
  }
}
