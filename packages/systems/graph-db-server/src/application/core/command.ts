import type { Graph, GraphDelta, GraphNode } from '@vt/graph-model/graph'
import type { VaultState } from '@vt/graph-db-server/contract'
import type { Session } from './session.ts'

export type Command =
  | { type: 'AddVaultReadPath'; path: string }
  | {
      type: 'ApplyGraphDeltaToDB'
      delta: GraphDelta
      recordForUndo?: boolean
    }
  | {
      type: 'CreateContextNode'
      parentNodeId: string
      semanticNodeIds: string[]
    }
  | {
      type: 'CreateContextNodeFromQuestion'
      nodeIds: string[]
      question: string
      semanticNodeIds: string[]
    }
  | {
      type: 'CreateContextNodeFromSelectedNodes'
      taskNodeId: string
      selectedNodeIds: string[]
    }
  | { type: 'FindFileByName'; name: string; searchPath: string }
  | {
      type: 'GetPreviewContainedNodeIds'
      nodeId: string
    }
  | {
      type: 'GetUnseenNodesAroundContextNode'
      contextNodeId: string
      searchFromNode?: string
    }
  | { type: 'GetWatchedDirectory' }
  | { type: 'PerformRedo' }
  | { type: 'PerformUndo' }
  | { type: 'ReadVaultState' }
  | { type: 'RegistryTouch'; sessionId: string }
  | { type: 'RemoveVaultReadPath'; path: string }
  | { type: 'ProjectAndBroadcast'; session: Session }
  | { type: 'PublishDelta'; delta: GraphDelta; source: string }
  | { type: 'ReadGraph' }
  | { type: 'ReadGraphNode'; nodeId: string }
  | { type: 'ReconcileGraphWithDisk' }
  | { type: 'SetGraph'; graph: Graph }
  | { type: 'SetVaultWriteFolderPath'; path: string }
  | {
      type: 'UpdateContextNodeContainedIds'
      contextNodeId: string
      newNodeIds: string[]
    }
  | { type: 'WriteAllPositions'; graph: Graph; projectRoot: string }

export type CommandOutput = {
  AddVaultReadPath: { readonly success: boolean; readonly error?: string }
  ApplyGraphDeltaToDB: void
  CreateContextNode: string
  CreateContextNodeFromQuestion: string
  CreateContextNodeFromSelectedNodes: string
  FindFileByName: readonly string[]
  GetPreviewContainedNodeIds: readonly string[]
  GetUnseenNodesAroundContextNode: unknown
  GetWatchedDirectory: string | null | undefined
  PerformRedo: boolean
  PerformUndo: boolean
  ProjectAndBroadcast: void
  PublishDelta: void
  ReadGraph: Graph
  ReadGraphNode: GraphNode | undefined
  ReconcileGraphWithDisk: GraphDelta
  ReadVaultState: VaultState
  RegistryTouch: void
  RemoveVaultReadPath: { readonly success: boolean; readonly error?: string }
  SetGraph: void
  SetVaultWriteFolderPath: { readonly success: boolean; readonly error?: string }
  UpdateContextNodeContainedIds: void
  WriteAllPositions: void
}
