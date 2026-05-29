import {resolveVoicetreeHomePath} from '@vt/paths'
import type { HealthOwner, HealthResponse } from '../contract.ts'
import type { FolderTreeScanner } from '../data/folder-tree-cache/types.ts'

export type DaemonHandle = {
  port: number
  stop(): Promise<void>
  alreadyRunning?: { pid: number }
}

export type DaemonLogger = {
  error(message?: unknown, ...optionalParams: unknown[]): void
  writeStderr(message: string): void
}

export type StartDaemonOptions = {
  vault?: string | null
  port?: number
  logLevel?: 'info' | 'debug'
  voicetreeHomePath?: string
  idleTimeoutMs?: number
  clock?: () => number
  logger?: DaemonLogger
  // Called after /shutdown finishes its teardown (server close, lock release,
  // port-file delete). The bin sets this to process.exit(0); tests leave it
  // unset so vitest workers survive.
  onShutdownComplete?: () => void | Promise<void>
  // When the vault is empty, auto-create a starter node so first-run UI users
  // see a non-empty graph. Defaults to true to preserve shell behavior; tests
  // pass false to keep their world pristine.
  createStarterIfEmpty?: boolean
  // Self-exit when the kernel reparents this daemon to PID 1 (parent died).
  // Set by Electron's vaultless spawn so a crashed/jetsam-killed Electron
  // doesn't leak orphaned daemons. Disabled by default because launchd-owned
  // daemons (e.g. the future LaunchAgent path) have ppid=1 from the start.
  exitOnParentDeath?: boolean
  // Test seam: inject a folder-tree scanner so route/SSE tests can prove the
  // workflows do not re-invoke filesystem discovery on every read. Production
  // leaves this unset and the daemon installs a scanner that wraps
  // `getDirectoryTree` (returning null on missing/unreadable roots).
  folderTreeScanner?: FolderTreeScanner
}

function defaultClock(): number {
  return Date.now()
}

function defaultDaemonError(message?: unknown, ...optionalParams: unknown[]): void {
  console.error(message, ...optionalParams)
}

function defaultDaemonWriteStderr(message: string): void {
  process.stderr.write(message)
}

const defaultDaemonLogger: DaemonLogger = {
  error: defaultDaemonError,
  writeStderr: defaultDaemonWriteStderr,
}

export function resolveDaemonVoicetreeHomePath(opts: StartDaemonOptions): string {
  return opts.voicetreeHomePath ?? resolveVoicetreeHomePath()
}

export function resolveDaemonClock(opts: StartDaemonOptions): () => number {
  return opts.clock ?? defaultClock
}

export function resolveDaemonLogger(opts: StartDaemonOptions): DaemonLogger {
  return opts.logger ?? defaultDaemonLogger
}

export function buildHealthResponse(
  version: string,
  vault: string | null,
  startMs: number,
  nowMs: number,
  sessionCount: number,
  owner: HealthOwner | null,
): HealthResponse {
  return {
    version,
    vault,
    uptimeSeconds: Math.floor((nowMs - startMs) / 1000),
    sessionCount,
    owner,
  }
}
