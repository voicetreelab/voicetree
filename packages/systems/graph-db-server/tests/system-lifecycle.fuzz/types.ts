export type ActionType =
  | 'createFile'
  | 'deleteFile'
  | 'upsertNodeDelta'
  | 'upsertNodeWithEdges'
  | 'updateExistingNode'
  | 'deleteNodeDelta'
  | 'deleteNodeEndpoint'
  | 'getGraph'

export interface FuzzAction {
  type: ActionType
  execute: () => Promise<void>
}

export interface TrackedNode {
  id: string
  content: string
  edges: string[]
}

export interface TrackedState {
  filesOnDisk: Map<string, string>
  nodesViaApi: Map<string, TrackedNode>
  deletedNodeIds: Set<string>
}

export interface GraphNode {
  absoluteFilePathIsID: string
  outgoingEdges: Array<{ targetId: string }>
  contentWithoutYamlOrLinks: string
}
