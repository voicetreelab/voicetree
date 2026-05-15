import { initGraphModel } from '@vt/graph-model'
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
import { getProjectRootWatchedDirectory } from '@vt/graph-db-server/state/watch-folder-store'
import { VaultStateSchema } from '@vt/graph-db-server/contract'
import {
  addReadPath,
  getReadPaths,
  getWritePath,
  removeReadPath,
  setWritePath,
} from '@vt/graph-db-server/state/vaultAllowlist'
import type { Command, CommandOutput } from './command.ts'
import type { SessionRegistry } from '../session/registry.ts'
import { projectAndBroadcast } from '../session/projectAndBroadcast.ts'
import { VaultNotOpenError } from '../errors/vaultNotOpen.ts'

export type { Command, CommandOutput } from './command.ts'

type RunCommandDeps = {
  registry?: SessionRegistry
}

function requireRegistry(deps: RunCommandDeps): SessionRegistry {
  if (!deps.registry) {
    throw new Error('Command requires a session registry')
  }
  return deps.registry
}

async function readVaultState(): Promise<CommandOutput['ReadVaultState']> {
  const vaultPath = getProjectRootWatchedDirectory()
  if (!vaultPath) {
    throw new VaultNotOpenError()
  }

  const readPaths = [...(await getReadPaths())]
  const writePathOption = await getWritePath() as { readonly value?: unknown }
  const writePath = typeof writePathOption.value === 'string'
    ? writePathOption.value
    : vaultPath

  return VaultStateSchema.parse({ vaultPath, readPaths, writePath })
}

export async function runCommand<C extends Command>(
  command: C,
  deps: RunCommandDeps = {},
): Promise<CommandOutput[C['type']]> {
  switch (command.type) {
    case 'AddVaultReadPath':
      return await addReadPath(command.path) as CommandOutput[C['type']]
    case 'ApplyGraphDeltaToDB':
      await applyGraphDeltaToDBThroughMemAndUI(
        command.delta,
        command.recordForUndo ?? true,
      )
      return undefined as CommandOutput[C['type']]
    case 'CreateContextNode':
      return await createContextNode(
        command.parentNodeId,
        command.semanticNodeIds,
      ) as CommandOutput[C['type']]
    case 'CreateContextNodeFromQuestion':
      return await createContextNodeFromQuestion(
        command.nodeIds,
        command.question,
        command.semanticNodeIds,
      ) as CommandOutput[C['type']]
    case 'CreateContextNodeFromSelectedNodes':
      return await createContextNodeFromSelectedNodes(
        command.taskNodeId,
        command.selectedNodeIds,
      ) as CommandOutput[C['type']]
    case 'FindFileByName':
      return await findFileByName(
        command.name,
        command.searchPath,
      ) as CommandOutput[C['type']]
    case 'GetPreviewContainedNodeIds':
      return await getPreviewContainedNodeIds(
        command.nodeId,
      ) as CommandOutput[C['type']]
    case 'GetUnseenNodesAroundContextNode':
      return await getUnseenNodesAroundContextNode(
        command.contextNodeId,
        command.searchFromNode,
      ) as CommandOutput[C['type']]
    case 'GetWatchedDirectory':
      return getProjectRootWatchedDirectory() as CommandOutput[C['type']]
    case 'InitializeGraphModel':
      initGraphModel({ appSupportPath: command.appSupportPath })
      return undefined as CommandOutput[C['type']]
    case 'PerformRedo':
      return await performRedo() as CommandOutput[C['type']]
    case 'PerformUndo':
      return await performUndo() as CommandOutput[C['type']]
    case 'ProjectAndBroadcast':
      await projectAndBroadcast(command.session)
      return undefined as CommandOutput[C['type']]
    case 'PublishDelta':
      publish({ delta: command.delta, source: command.source })
      return undefined as CommandOutput[C['type']]
    case 'ReadGraph':
      return getGraph() as CommandOutput[C['type']]
    case 'ReadGraphNode':
      return getNode(command.nodeId) as CommandOutput[C['type']]
    case 'ReadVaultState':
      return await readVaultState() as CommandOutput[C['type']]
    case 'RegistryTouch':
      requireRegistry(deps).touch(command.sessionId)
      return undefined as CommandOutput[C['type']]
    case 'RemoveVaultReadPath':
      return await removeReadPath(command.path) as CommandOutput[C['type']]
    case 'SetGraph':
      setGraph(command.graph)
      return undefined as CommandOutput[C['type']]
    case 'SetVaultWritePath':
      return await setWritePath(command.path) as CommandOutput[C['type']]
    case 'UpdateContextNodeContainedIds':
      await updateContextNodeContainedIds(
        command.contextNodeId,
        command.newNodeIds,
      )
      return undefined as CommandOutput[C['type']]
    case 'WriteAllPositions':
      writeAllPositionsSync(command.graph, command.projectRoot)
      return undefined as CommandOutput[C['type']]
    default: {
      const _exhaustive: never = command
      return _exhaustive
    }
  }
}
