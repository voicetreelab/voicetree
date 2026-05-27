export {
  createGraphDbClient,
  GraphDbClient,
  type GraphDbClientApi,
  type GraphDbClientOptions,
} from './GraphDbClient.ts'
export {
  DaemonLaunchTimeout,
  DaemonLockHeldError,
  DaemonUnreachableError,
  GraphDbClientError,
  OwnerSpawnCooldownError,
  OwnerWaitTimeoutError,
  UnsafeOwnerError,
  VaultNotOpenError,
  VaultOpenFailedError,
} from './errors.ts'
export { readPortFile, discoverPort } from './portDiscovery.ts'
export {
  ensureDaemon,
  ensureGraphDaemonForVault,
  resolveDaemonRuntimeCommand,
  type EnsureDaemonResult,
  type EnsureGraphDaemonOptions,
  type EnsureGraphDaemonResult,
} from './autoLaunch.ts'
// BF-369: diagnostics bus + cooldown breadcrumb live in @vt/daemon-lifecycle.
// Re-export the bus subscription + breadcrumb read helpers here so existing
// graph-db-client consumers (webapp Electron shell, voicetree-cli) don't
// need to add an extra dep just for these symbols.
export {
  cooldownBreadcrumbPathFor,
  subscribeOwnerDiagnostics,
  type CooldownBreadcrumb,
  type OwnerDiagnosticListener,
  type OwnerDiagnosticUnsubscribe,
} from '@vt/daemon-lifecycle'
export {
  isVtGraphdProcessForVault,
  killOrphanVtGraphdDaemons,
  terminateUnresponsiveDaemon,
  type OrphanCleanupResult,
} from './orphanCleanup.ts'

export * from './contract.ts'
