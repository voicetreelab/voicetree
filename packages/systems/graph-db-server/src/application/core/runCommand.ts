import { access } from 'node:fs/promises'
import * as O from 'fp-ts/lib/Option.js'
import { getCallbacks, type DeleteNode } from '@vt/graph-model'
import {
  applyGraphDeltaToDBThroughMemAndUI,
  applyGraphDeltaToMemState,
  refreshGraphChangeSideEffects,
} from '@vt/graph-db-server/graph/applyGraphDelta'
import { findFileByName } from '@vt/graph-db-server/graph/findFileByName'
import { getPreviewContainedNodeIds } from '@vt/graph-db-server/context-nodes/getPreviewContainedNodeIds'
import { performRedo, performUndo } from '@vt/graph-db-server/graph/undoOperations'
import { writeAllPositionsSync } from '@vt/graph-db-server/graph/writeAllPositionsOnExit'
import { createContextNode } from '@vt/graph-db-server/context-nodes/createContextNode'
import { createContextNodeFromQuestion } from '@vt/graph-db-server/context-nodes/createContextNodeFromQuestion'
import { createContextNodeFromSelectedNodes } from '@vt/graph-db-server/context-nodes/createContextNodeFromSelectedNodes'
import { getUnseenNodesAroundContextNode } from '@vt/graph-db-server/context-nodes/getUnseenNodesAroundContextNode'
import { updateContextNodeContainedIds } from '@vt/graph-db-server/context-nodes/updateContextNodeContainedIds'
import { getGraph, getNode, setGraph } from '@vt/graph-db-server/state/graph-store'
import { publish } from '@vt/graph-db-server/state/events/deltaEventBus'
import { getProjectRoot } from '@vt/graph-db-server/state/watch-folder-store'
import { VaultStateSchema } from '@vt/graph-db-server/contract'
import {
  addReadPath,
  getReadPaths,
  getWriteFolderPath,
  removeReadPath,
  setWriteFolderPath,
} from '@vt/graph-db-server/state/vaultAllowlist'
import { isPendingWrite } from '@vt/graph-db-server/watch-folder/pending-writes'
import type { Command, CommandOutput } from './command.ts'
import type { SessionRegistry } from '../session/registry.ts'
import { projectAndBroadcast } from '../session/projectAndBroadcast.ts'
import { VaultNotOpenError } from '../errors/vaultNotOpen.ts'

export type { Command, CommandOutput } from './command.ts'

type RunCommandDeps = {
  registry?: SessionRegistry
}

type CommandHandler<T extends Command['type']> = (
  command: Extract<Command, { type: T }>,
  deps: RunCommandDeps,
) => Promise<CommandOutput[T]> | CommandOutput[T]

type CommandHandlers = {
  [T in Command['type']]: CommandHandler<T>
}

function requireRegistry(deps: RunCommandDeps): SessionRegistry {
  if (!deps.registry) {
    throw new Error('Command requires a session registry')
  }
  return deps.registry
}

async function readVaultState(): Promise<CommandOutput['ReadVaultState']> {
  const projectRoot = getProjectRoot()
  if (!projectRoot) {
    throw new VaultNotOpenError()
  }

  const readPaths = [...(await getReadPaths())]
  const writeFolderPathOption = await getWriteFolderPath() as { readonly value?: unknown }
  const writeFolderPath = typeof writeFolderPathOption.value === 'string'
    ? writeFolderPathOption.value
    : projectRoot

  return VaultStateSchema.parse({ projectRoot, readPaths, writeFolderPath })
}

async function pathExistsOnDisk(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath)
    return true
  } catch {
    return false
  }
}

async function reconcileGraphWithDisk(): Promise<CommandOutput['ReconcileGraphWithDisk']> {
  const currentGraph = getGraph()
  const deletes: DeleteNode[] = []
  for (const [nodeId, node] of Object.entries(currentGraph.nodes)) {
    if (isPendingWrite(nodeId)) continue
    if (await pathExistsOnDisk(nodeId)) continue
    deletes.push({ type: 'DeleteNode', nodeId, deletedNode: O.some(node) })
  }
  if (deletes.length === 0) return []

  const mergedDelta = await applyGraphDeltaToMemState(deletes)
  refreshGraphChangeSideEffects()
  publish({ delta: mergedDelta, source: 'reconcile:disk', suppressForSubscribers: [] })
  getCallbacks().onFloatingEditorUpdate?.(mergedDelta, [])
  return mergedDelta
}

const commandHandlers = {
  AddVaultReadPath: command => addReadPath(command.path),
  ApplyGraphDeltaToDB: async command => {
    await applyGraphDeltaToDBThroughMemAndUI(
      command.delta,
      command.recordForUndo ?? true,
    )
  },
  CreateContextNode: command => createContextNode(
    command.parentNodeId,
    command.semanticNodeIds,
  ),
  CreateContextNodeFromQuestion: command => createContextNodeFromQuestion(
    command.nodeIds,
    command.question,
    command.semanticNodeIds,
  ),
  CreateContextNodeFromSelectedNodes: command => createContextNodeFromSelectedNodes(
    command.taskNodeId,
    command.selectedNodeIds,
  ),
  FindFileByName: command => findFileByName(
    command.name,
    command.searchPath,
  ),
  GetPreviewContainedNodeIds: command => getPreviewContainedNodeIds(command.nodeId),
  GetUnseenNodesAroundContextNode: command => getUnseenNodesAroundContextNode(
    command.contextNodeId,
    command.searchFromNode,
  ),
  GetWatchedDirectory: () => getProjectRoot(),
  PerformRedo: () => performRedo(),
  PerformUndo: () => performUndo(),
  ProjectAndBroadcast: async command => {
    await projectAndBroadcast(command.session)
  },
  PublishDelta: command => {
    publish({ delta: command.delta, source: command.source })
  },
  ReadGraph: () => getGraph(),
  ReadGraphNode: command => getNode(command.nodeId),
  ReconcileGraphWithDisk: () => reconcileGraphWithDisk(),
  ReadVaultState: () => readVaultState(),
  RegistryTouch: (command, deps) => {
    requireRegistry(deps).touch(command.sessionId)
  },
  RemoveVaultReadPath: command => removeReadPath(command.path),
  SetGraph: command => {
    setGraph(command.graph)
  },
  SetVaultWriteFolderPath: command => setWriteFolderPath(command.path),
  UpdateContextNodeContainedIds: async command => {
    await updateContextNodeContainedIds(
      command.contextNodeId,
      command.newNodeIds,
    )
  },
  WriteAllPositions: command => {
    writeAllPositionsSync(command.graph, command.projectRoot)
  },
} satisfies CommandHandlers

export function runCommand<C extends Command>(
  command: C,
  deps?: RunCommandDeps,
): Promise<CommandOutput[C['type']]>

export async function runCommand(
  command: Command,
  deps: RunCommandDeps = {},
): Promise<CommandOutput[Command['type']]> {
  const handler = commandHandlers[command.type] as unknown as (
    command: Command,
    deps: RunCommandDeps,
  ) => Promise<CommandOutput[Command['type']]> | CommandOutput[Command['type']]

  return await handler(command, deps)
}
