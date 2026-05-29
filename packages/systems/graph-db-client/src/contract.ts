import type {
  ActiveView,
  FolderStateEntry,
  VaultState,
} from '@vt/graph-db-protocol'

export {
  AddReadPathRequestSchema,
  CONTRACT_VERSION,
  CloneViewRequestSchema,
  CreateViewRequestSchema,
  FolderStateBatchRequestSchema,
  FolderStatePatchRequestSchema,
  FolderStateResponseSchema,
  GraphStateSchema,
  HealthResponseSchema,
  LayoutPartialSchema,
  LayoutResponseSchema,
  ListViewsResponseSchema,
  LiveStateSnapshotSchema,
  SelectionModeSchema,
  SelectionRequestSchema,
  SelectionResponseSchema,
  SessionCreateResponseSchema,
  SessionInfoSchema,
  SetWriteFolderPathRequestSchema,
  ShutdownResponseSchema,
  UnseenNodeSchema,
  VaultStateSchema,
  ViewRecordSchema,
  ViewResponseSchema,
  type ActiveView,
  type CloneViewRequest,
  type CollapseStateResponse,
  type CreateViewRequest,
  type FolderState,
  type FolderStateBatchRequest,
  type FolderStateBatchUpdate,
  type FolderStateEntry,
  type FolderStatePatchRequest,
  type FolderStateResponse,
  type GraphState,
  type HealthResponse,
  type LayoutPartial,
  type LayoutResponse,
  type ListViewsResponse,
  type LiveStateSnapshot,
  type SelectionMode,
  type SelectionRequest,
  type SelectionResponse,
  type SessionCreateResponse,
  type SessionInfo,
  type SetWriteFolderPathRequest,
  type ShutdownResponse,
  type UnseenNode,
  type VaultState,
  type ViewRecord,
  type ViewResponse,
} from '@vt/graph-db-protocol'

export type OpenVaultResponse = {
  sessionId: string
  writeFolderPath: string
  vaultState: VaultState
  initialProjectedGraph: unknown
  folderState: FolderStateEntry[]
  activeView: ActiveView
}
