import type { Graph, GraphDelta, GraphNode, Size } from '@vt/graph-model/graph'
import type { ProjectState } from '@vt/graph-db-server/contract'
import type { Session } from './session.ts'

export type Command =
  | { type: 'AddProjectReadPath'; path: string }
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
  | { type: 'ReadProjectState' }
  | { type: 'RegistryTouch'; sessionId: string }
  | { type: 'RemoveProjectReadPath'; path: string }
  | { type: 'ProjectAndBroadcast'; session: Session }
  | { type: 'PublishDelta'; delta: GraphDelta; source: string }
  | { type: 'ReadGraph' }
  | { type: 'ReadGraphNode'; nodeId: string }
  | { type: 'ReconcileGraphWithDisk' }
  | { type: 'SetGraph'; graph: Graph }
  | { type: 'SetProjectWriteFolderPath'; path: string }
  | {
      type: 'UpdateContextNodeContainedIds'
      contextNodeId: string
      newNodeIds: string[]
    }
  | { type: 'MergeFolderLayout'; entries: ReadonlyMap<string, Size> }
  | { type: 'WriteAllNodeLayout'; graph: Graph; projectRoot: string }

export type CommandOutput = {
  AddProjectReadPath: { readonly success: boolean; readonly error?: string }
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
  ReadProjectState: ProjectState
  RegistryTouch: void
  RemoveProjectReadPath: { readonly success: boolean; readonly removedNodeCount: number; readonly error?: string }
  SetGraph: void
  SetProjectWriteFolderPath: { readonly success: boolean; readonly error?: string }
  UpdateContextNodeContainedIds: void
  MergeFolderLayout: void
  WriteAllNodeLayout: void
}
