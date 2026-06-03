/**
 * Playwright globalTeardown for the browser daemon round-trip tier.
 *
 * Reverses globalSetup using the handoff file (globalSetup's in-memory handle is
 * not reachable here). Each step is wrapped so one failure cannot strand the
 * rest: kill `vt serve` → ensureCleanProject (kills graphd+vtd by owner-record
 * pid; `vt serve` SIGTERM alone does NOT, BF-346) → shut down the harness's OWN
 * tmux server (socket-scoped via the spawned daemon's home) → rm the tmp
 * project/home and the handoff file.
 *
 * SAFETY (fleet-kill regression): the daemon the harness boots runs every agent
 * pane on `-S <home>/tmux.sock`, isolated under the tmp home globalSetup created.
 * Teardown MUST scope its kill to that socket. A bare `tmux kill-server` here
 * resolves the socket from the inherited `$TMUX`, which — when this tier runs
 * inside a VoiceTree agent pane — points at the SHARED `~/.voicetree/tmux.sock`
 * and tears down every concurrent agent's pane. `shutdownTmuxServer` derives the
 * socket from the home path (`-S <home>/tmux.sock`) and can never reach the
 * shared server.
 */

import {readFile, rm} from 'node:fs/promises'
import {ensureCleanProject} from '@vt/daemon-test-harness'
import {shutdownTmuxServer} from '@vt/vt-daemon/agent-runtime/terminals/tmux/tmux-server.ts'
import {DAEMON_CONFIG_FILE} from './vt-e2e-helpers.ts'

export default async function globalTeardown(): Promise<void> {
  let cfg: {servePid?: number; projectPath?: string; homePath?: string}
  try {
    cfg = JSON.parse(await readFile(DAEMON_CONFIG_FILE, 'utf8'))
  } catch {
    return // nothing was booted (globalSetup failed early) — nothing to clean
  }

  if (typeof cfg.servePid === 'number') {
    try {
      process.kill(cfg.servePid, 'SIGTERM')
    } catch {
      // already gone
    }
  }

  if (typeof cfg.projectPath === 'string') {
    await ensureCleanProject(cfg.projectPath).catch(() => undefined)
  }

  if (typeof cfg.homePath === 'string') {
    // Socket-scoped to <homePath>/tmux.sock — never the shared production server.
    await shutdownTmuxServer({voicetreeHomePath: cfg.homePath}).catch(() => undefined)
  }

  for (const dir of [cfg.projectPath, cfg.homePath]) {
    if (typeof dir === 'string') {
      await rm(dir, {recursive: true, force: true}).catch(() => undefined)
    }
  }
  await rm(DAEMON_CONFIG_FILE, {force: true}).catch(() => undefined)
}
