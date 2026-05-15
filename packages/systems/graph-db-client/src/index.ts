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

export * from './contract.ts'
