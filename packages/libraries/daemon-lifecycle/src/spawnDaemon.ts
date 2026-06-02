/**
 * Generic detached daemon spawn.
 *
 * The caller resolves the command + args (graphd uses
 * `resolveCommand(project, bin?)` from graph-db-client; vt-daemon-client
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
 *
 * `launcherPid` arms the daemon's parent-pid watchdog (vtd.ts / vt-graphd.ts
 * / parent_pid_watchdog.py): the child env always carries
 * `VOICETREE_PARENT_PID`, so an orphaned daemon self-exits when the app dies
 * instead of leaking until reboot. The value PROPAGATES — if the launcher
 * already inherited a `VOICETREE_PARENT_PID` it is kept verbatim, otherwise
 * the launcher's own pid is stamped:
 *
 *   - app -> VTD: app has no ancestor var → stamps the app pid; VTD's
 *     watchdog points at the app. ✓
 *   - VTD -> graphd: the VTD inherited `VOICETREE_PARENT_PID=<app pid>` →
 *     PROPAGATES it; graphd points at the APP, not the VTD. This preserves
 *     the BF-346 invariant (graphd is a sibling that outlives VTD restarts —
 *     it must only die when the app dies). Stamping the VTD's own pid here
 *     would tie graphd's life to the spawning VTD and break that. ✓
 *   - CLI -> VTD: stamps the CLI pid; the daemon dies with the CLI. ✓
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
   * The launching process's pid, threaded in from the shell boundary (the
   * spawn coordinator reads `process.pid`). Used as the fallback
   * `VOICETREE_PARENT_PID` when the launcher's env carries no inherited
   * value — see {@link buildDaemonChildEnv}.
   */
  readonly launcherPid: number
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
  const stdio: ('ignore' | number)[] = input.logPath
    ? ['ignore', openSync(input.logPath, 'a'), openSync(input.logPath, 'a')]
    : ['ignore', 'ignore', 'ignore']
  const child = spawn(input.cmd, [...input.args], {
    detached: true,
    env: buildDaemonChildEnv(input),
    stdio,
  })
  child.unref()
  child.on('error', () => {
    // Errors here surface as the wait-for-health loop timing out, which
    // is the right boundary: we want one launch-failure shape, not two.
  })
  return { pid: child.pid ?? null, process: child }
}

export type DaemonChildEnvInput = {
  readonly env: SpawnEnvVarShape
  readonly daemonKind: DaemonKind
  readonly caller: CallerKind
  readonly launcherPid: number
}

/**
 * Build the child environment for a daemon spawn: the launcher's env plus the
 * daemon-kind caller var and the propagated `VOICETREE_PARENT_PID`. Pure —
 * the impure `process.pid` read is the caller's; the value is threaded in as
 * `launcherPid`. See {@link spawnDaemon} for the propagation rationale.
 */
export function buildDaemonChildEnv(input: DaemonChildEnvInput): NodeJS.ProcessEnv {
  return {
    ...input.env,
    [envVarNameFor(input.daemonKind)]: input.caller,
    VOICETREE_PARENT_PID: input.env.VOICETREE_PARENT_PID ?? String(input.launcherPid),
  }
}

function envVarNameFor(daemonKind: DaemonKind): 'VT_GRAPHD_CALLER_KIND' | 'VT_DAEMON_CALLER_KIND' {
  return daemonKind === 'graphd' ? 'VT_GRAPHD_CALLER_KIND' : 'VT_DAEMON_CALLER_KIND'
}
