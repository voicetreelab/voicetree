export type FuzzActionType =
  | 'createFile'
  | 'deleteFile'
  | 'upsertNodeDelta'
  | 'upsertNodeWithEdges'
  | 'updateExistingNode'
  | 'deleteNodeDelta'
  | 'deleteNodeEndpoint'
  | 'getGraph'

export interface TrackedNode {
  id: string
  content: string
  edges: string[]
}

export interface TrackedState {
  filesOnDisk: Map<string, string> // path -> expected content
  nodesViaApi: Map<string, TrackedNode> // id -> tracked node
  deletedNodeIds: Set<string> // nodes we explicitly deleted (daemon doesn't cascade incoming edges)
  // Every node id the test has touched this sequence (via createFile,
  // upsertNodeDelta, upsertNodeWithEdges). Never removed — used by the drainer
  // to scope cleanup to test-owned ids and ignore daemon-managed nodes
  // (e.g. today/inbox scaffolding) that share the vault.
  testOwnedNodeIds: Set<string>
}

export interface FuzzAction {
  type: FuzzActionType
  execute: () => Promise<void>
}

export function emptyTrackedState(): TrackedState {
  return {
    filesOnDisk: new Map(),
    nodesViaApi: new Map(),
    deletedNodeIds: new Set(),
    testOwnedNodeIds: new Set(),
  }
}

// Resets per-sequence state but preserves `deletedNodeIds` across sequences.
// Carrying deletions forward keeps I3's `targetWasDeleted` predicate honest
// when a leaked node from sequence N points at a node deleted in sequence N
// and seen during sequence N+1.
export function resetForNextSequence(tracked: TrackedState): void {
  tracked.filesOnDisk.clear()
  tracked.nodesViaApi.clear()
  tracked.testOwnedNodeIds.clear()
}
