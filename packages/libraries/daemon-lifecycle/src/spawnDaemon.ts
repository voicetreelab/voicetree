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
 *  - `stdio: ['ignore', <log fd>, <log fd>]` when `logPath` is provided,
 *    else `['ignore', 'ignore', 'ignore']`. File descriptors are used
 *    rather than pipes so the launcher closing does not signal EPIPE
 *    into the daemon.
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
import { openSync } from 'node:fs'
import type { CallerKind, DaemonKind } from '@vt/graph-db-protocol'

export type SpawnEnvVarShape = NodeJS.ProcessEnv

export type SpawnDaemonInput = {
  readonly daemonKind: DaemonKind
  readonly cmd: string
  readonly args: readonly string[]
  readonly env: SpawnEnvVarShape
  readonly caller: CallerKind
  /**
   * Optional path the daemon's stdout and stderr are appended to. When
   * omitted, both streams are discarded — preserves the original silent
   * behavior for callers that don't supply a log location.
   *
   * Open in append mode so multiple daemon generations (re-spawns after
   * a crash) accumulate rather than truncate. The fd is closed by the
   * OS when the child exits.
   */
  readonly logPath?: string
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
  const stdio: ('ignore' | number)[] = input.logPath
    ? ['ignore', openSync(input.logPath, 'a'), openSync(input.logPath, 'a')]
    : ['ignore', 'ignore', 'ignore']
  const child = spawn(input.cmd, [...input.args], {
    detached: true,
    env: {
      ...input.env,
      [callerEnvName]: input.caller,
    },
    stdio,
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
