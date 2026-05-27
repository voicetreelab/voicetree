import { applyGraphDeltaToDBThroughMemAndUI } from '@vt/graph-db-server/graph/applyGraphDelta'
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
  getWriteFolder,
  removeReadPath,
  setWriteFolder,
} from '@vt/graph-db-server/state/vaultAllowlist'
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
  const writeFolderOption = await getWriteFolder() as { readonly value?: unknown }
  const writeFolder = typeof writeFolderOption.value === 'string'
    ? writeFolderOption.value
    : projectRoot

  return VaultStateSchema.parse({ projectRoot, readPaths, writeFolder })
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
  ReadVaultState: () => readVaultState(),
  RegistryTouch: (command, deps) => {
    requireRegistry(deps).touch(command.sessionId)
  },
  RemoveVaultReadPath: command => removeReadPath(command.path),
  SetGraph: command => {
    setGraph(command.graph)
  },
  SetVaultWriteFolder: command => setWriteFolder(command.path),
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
