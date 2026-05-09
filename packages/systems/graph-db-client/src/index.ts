export { GraphDbClient } from './GraphDbClient.ts'
export {
  DaemonLaunchTimeout,
  DaemonLockHeldError,
  DaemonUnreachableError,
  GraphDbClientError,
} from './errors.ts'
export { readPortFile, discoverPort } from './portDiscovery.ts'
export {
  ensureDaemon,
  type EnsureDaemonResult,
} from './autoLaunch.ts'
export {
  isVtGraphdProcessForVault,
  killOrphanVtGraphdDaemons,
  terminateUnresponsiveDaemon,
  type OrphanCleanupResult,
} from './orphanCleanup.ts'

export {
  CONTRACT_VERSION,
  AddReadPathRequestSchema,
  CollapseStateResponseSchema,
  GraphStateSchema,
  HealthResponseSchema,
  LayoutPartialSchema,
  LayoutResponseSchema,
  LiveStateSnapshotSchema,
  SelectionModeSchema,
  SelectionRequestSchema,
  SelectionResponseSchema,
  SessionCreateResponseSchema,
  SessionInfoSchema,
  SetWritePathRequestSchema,
  ShutdownResponseSchema,
  VaultStateSchema,
  ViewResponseSchema,
  type AddReadPathRequest,
  type CollapseStateResponse,
  type GraphState,
  type HealthResponse,
  type LayoutPartial,
  type LayoutResponse,
  type LiveStateSnapshot,
  type SelectionMode,
  type SelectionRequest,
  type SelectionResponse,
  type SessionCreateResponse,
  type SessionInfo,
  type SetWritePathRequest,
  type ShutdownResponse,
  type VaultState,
  type ViewResponse,
} from './contract.ts'
