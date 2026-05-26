/**
 * Public surface of `@vt/vt-daemon-client`.
 *
 * The package has exactly two public exports — the launcher and the client
 * class — plus their option/result types. Everything else (spawn helpers,
 * runtime resolver, in-flight cache) is internal.
 */

export {
  ensureVtDaemonForVault,
  type EnsureVtDaemonOptions,
  type EnsureVtDaemonResult,
} from './autoLaunch/ensureVtDaemon.ts'

export {
  VtDaemonClient,
  type VtDaemonClientOptions,
  type VtDaemonRpcResponse,
} from './VtDaemonClient.ts'
