import {
  ensureGraphDaemonForProject,
  type EnsureGraphDaemonOptions,
  type EnsureGraphDaemonResult,
} from './autoLaunch/ensureGraphDaemon.ts'
import { type EnsureDaemonResult } from './autoLaunch/types.ts'
import { resolveDaemonRuntimeCommand } from './autoLaunch/runtime.ts'

export type { EnsureDaemonResult } from './autoLaunch/types.ts'
export type {
  EnsureGraphDaemonOptions,
  EnsureGraphDaemonResult,
} from './autoLaunch/ensureGraphDaemon.ts'
export { resolveDaemonRuntimeCommand }
export { ensureGraphDaemonForProject }

/**
 * Thin delegate over {@link ensureGraphDaemonForProject} that returns the
 * legacy `EnsureDaemonResult` shape. Existing call sites (CLI commands,
 * tests, Electron) keep working through this signature while the owner
 * protocol takes over the underlying lifecycle. New code should call
 * {@link ensureGraphDaemonForProject} directly to receive the bound client
 * and owner identity.
 */
export async function ensureDaemon(
  project: string,
  opts?: { timeoutMs?: number; bin?: string },
): Promise<EnsureDaemonResult> {
  const result: EnsureGraphDaemonResult = await ensureGraphDaemonForProject(
    project,
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
