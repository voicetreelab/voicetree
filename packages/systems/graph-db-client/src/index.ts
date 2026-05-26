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
export {
  subscribeOwnerDiagnostics,
  type OwnerDiagnosticListener,
  type OwnerDiagnosticUnsubscribe,
} from './autoLaunch/diagnostics.ts'
export {
  cooldownBreadcrumbPathFor,
  COOLDOWN_BREADCRUMB_FILENAME,
  type CooldownBreadcrumb,
} from './autoLaunch/ownership/cooldownBreadcrumb.ts'
export {
  isVtGraphdProcessForVault,
  killOrphanVtGraphdDaemons,
  terminateUnresponsiveDaemon,
  type OrphanCleanupResult,
} from './orphanCleanup.ts'

export * from './contract.ts'
