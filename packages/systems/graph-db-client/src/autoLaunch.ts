import {
  ensureGraphDaemonForVault,
  type EnsureGraphDaemonOptions,
  type EnsureGraphDaemonResult,
} from './autoLaunch/ensureGraphDaemon.ts'
import { type EnsureDaemonResult } from './autoLaunch/types.ts'
import { resolveDaemonRuntimeCommand } from './autoLaunch/spawn/runtime.ts'

export type { EnsureDaemonResult } from './autoLaunch/types.ts'
export type {
  EnsureGraphDaemonOptions,
  EnsureGraphDaemonResult,
} from './autoLaunch/ensureGraphDaemon.ts'
export { resolveDaemonRuntimeCommand }
export { ensureGraphDaemonForVault }

/**
 * Thin delegate over {@link ensureGraphDaemonForVault} that returns the
 * legacy `EnsureDaemonResult` shape. Existing call sites (CLI commands,
 * tests, Electron) keep working through this signature while the owner
 * protocol takes over the underlying lifecycle. New code should call
 * {@link ensureGraphDaemonForVault} directly to receive the bound client
 * and owner identity.
 */
export async function ensureDaemon(
  vault: string,
  opts?: { timeoutMs?: number; bin?: string },
): Promise<EnsureDaemonResult> {
  const result: EnsureGraphDaemonResult = await ensureGraphDaemonForVault(
    vault,
    'graph-db-client',
    {
      timeoutMs: opts?.timeoutMs,
      bin: opts?.bin ?? process.env.VT_GRAPHD_BIN,
    },
  )
  return {
    port: result.port,
    pid: result.pid,
    launched: result.launched,
  }
}
