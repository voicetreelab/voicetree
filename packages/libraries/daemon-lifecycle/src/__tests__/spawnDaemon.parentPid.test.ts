/**
 * Parent-pid watchdog arming: the child env built for a project daemon spawn
 * must always carry `VOICETREE_PARENT_PID` so the daemon's (already-tested)
 * parent-pid watchdog can arm and self-exit when the launching app dies.
 *
 * Two cases, black-boxed on the pure env builder:
 *
 *   1. ROOT (electron / CLI): the launcher's own env has no
 *      VOICETREE_PARENT_PID, so the builder stamps the launcher's own pid —
 *      the daemon's watchdog then points at the launcher.
 *
 *   2. PROPAGATION (VTD-spawns-graphd): the launcher (a VTD) already inherited
 *      VOICETREE_PARENT_PID=<app pid> from the app that spawned it. The builder
 *      must PROPAGATE that inherited value unchanged — NOT overwrite it with the
 *      VTD's own pid — so graphd's watchdog points at the APP, not the VTD.
 *      This preserves the BF-346 invariant: graphd outlives VTD restarts and
 *      must only die when the app dies.
 */

import { describe, expect, test } from 'vitest'

import { buildDaemonChildEnv } from '../spawnDaemon.ts'

describe('buildDaemonChildEnv — parent-pid watchdog arming', () => {
  test('ROOT case: stamps the launcher pid when no ancestor VOICETREE_PARENT_PID is present', () => {
    const env = buildDaemonChildEnv({
      env: { PATH: '/usr/bin' },
      daemonKind: 'vtd',
      caller: 'electron-main',
      launcherPid: 4242,
    })

    expect(env.VOICETREE_PARENT_PID).toBe('4242')
  })

  test('PROPAGATION invariant: keeps the inherited VOICETREE_PARENT_PID, never overwrites with the launcher pid', () => {
    const env = buildDaemonChildEnv({
      // A VTD process carries the app pid it inherited at its own spawn.
      env: { PATH: '/usr/bin', VOICETREE_PARENT_PID: '9999' },
      daemonKind: 'graphd',
      caller: 'vtd',
      launcherPid: 4242,
    })

    // graphd points at the app (9999), NOT the spawning VTD (4242).
    expect(env.VOICETREE_PARENT_PID).toBe('9999')
  })

  test('still threads the daemon-kind caller env var alongside the parent pid', () => {
    const graphd = buildDaemonChildEnv({
      env: {},
      daemonKind: 'graphd',
      caller: 'electron-main',
      launcherPid: 7,
    })
    const vtd = buildDaemonChildEnv({
      env: {},
      daemonKind: 'vtd',
      caller: 'cli',
      launcherPid: 7,
    })

    expect(graphd.VT_GRAPHD_CALLER_KIND).toBe('electron-main')
    expect(vtd.VT_DAEMON_CALLER_KIND).toBe('cli')
  })

  test('preserves the rest of the launcher env (full pass-through for OTLP etc.)', () => {
    const env = buildDaemonChildEnv({
      env: { PATH: '/usr/bin', VOICETREE_OTLP_ENDPOINT: 'http://127.0.0.1:4318' },
      daemonKind: 'graphd',
      caller: 'electron-main',
      launcherPid: 1,
    })

    expect(env.PATH).toBe('/usr/bin')
    expect(env.VOICETREE_OTLP_ENDPOINT).toBe('http://127.0.0.1:4318')
  })
})
