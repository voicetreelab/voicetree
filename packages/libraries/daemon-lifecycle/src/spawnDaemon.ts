/**
 * Generic detached daemon spawn.
 *
 * The caller resolves the command + args (graphd uses
 * `resolveCommand(vault, bin?)` from graph-db-client; vt-daemon-client
 * will provide its own resolver). This helper handles only the universal
 * mechanics of "spawn detached, swallow child errors, return the pid":
 *
 *  - `detached: true` + `child.unref()` so the daemon's lifetime is
 *    decoupled from the launcher's. The launcher exiting must not kill
 *    the daemon (the parent-pid watchdog handles the inverse case).
 *  - `stdio: ['ignore', 'ignore', 'ignore']` so the daemon is not
 *    talking to a pipe the launcher could close.
 *  - `child.on('error', …)` swallows spawn-time errors; the
 *    wait-for-health loop times out and surfaces the failure as a single
 *    `DaemonLaunchTimeout` shape, so we don't have two failure modes for
 *    the same condition.
 *
 * `daemonKind` selects which env-var name the caller kind is propagated
 * through, so a single bin can introspect "who launched me?" without
 * sharing an env-var with the other daemon kind.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import type { CallerKind, DaemonKind } from '@vt/graph-db-protocol'

export type SpawnEnvVarShape = NodeJS.ProcessEnv

export type SpawnDaemonInput = {
  readonly daemonKind: DaemonKind
  readonly cmd: string
  readonly args: readonly string[]
  readonly env: SpawnEnvVarShape
  readonly caller: CallerKind
}

export type SpawnedDaemonHandle = {
  readonly pid: number | null
  readonly process: ChildProcess
}

// `env` is required (no `?? process.env` fallback): the transitive-purity
// gate flags any `process.*` read in a function body, so callers thread
// the env in from the shell boundary.
export function spawnDaemon(input: SpawnDaemonInput): SpawnedDaemonHandle {
  const callerEnvName = envVarNameFor(input.daemonKind)
  const child = spawn(input.cmd, [...input.args], {
    detached: true,
    env: {
      ...input.env,
      [callerEnvName]: input.caller,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  child.unref()
  child.on('error', () => {
    // Errors here surface as the wait-for-health loop timing out, which
    // is the right boundary: we want one launch-failure shape, not two.
  })
  return { pid: child.pid ?? null, process: child }
}

function envVarNameFor(daemonKind: DaemonKind): 'VT_GRAPHD_CALLER_KIND' | 'VT_DAEMON_CALLER_KIND' {
  return daemonKind === 'graphd' ? 'VT_GRAPHD_CALLER_KIND' : 'VT_DAEMON_CALLER_KIND'
}
