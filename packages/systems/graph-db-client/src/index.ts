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
  spawnVaultlessDaemon,
  type EnsureDaemonResult,
  type EnsureGraphDaemonOptions,
  type EnsureGraphDaemonResult,
  type SpawnVaultlessDaemonOptions,
  type VaultlessDaemonHandle,
} from './autoLaunch.ts'
export {
  isVtGraphdProcessForVault,
  killOrphanVtGraphdDaemons,
  terminateUnresponsiveDaemon,
  type OrphanCleanupResult,
} from './orphanCleanup.ts'

export * from './contract.ts'
