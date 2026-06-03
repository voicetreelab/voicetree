/**
 * Playwright globalTeardown for the browser daemon round-trip tier.
 *
 * Reverses globalSetup using the handoff file (globalSetup's in-memory handle is
 * not reachable here). Each step is wrapped so one failure cannot strand the
 * rest: kill `vt serve` → ensureCleanProject (kills graphd+vtd by owner-record
 * pid; `vt serve` SIGTERM alone does NOT, BF-346) → tmux kill-server (hygiene)
 * → rm the tmp project/home and the handoff file.
 */

import {execFile} from 'node:child_process'
import {readFile, rm} from 'node:fs/promises'
import {ensureCleanProject} from '@vt/daemon-test-harness'
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

  await new Promise<void>((resolve) => {
    execFile('tmux', ['kill-server'], () => resolve())
  })

  for (const dir of [cfg.projectPath, cfg.homePath]) {
    if (typeof dir === 'string') {
      await rm(dir, {recursive: true, force: true}).catch(() => undefined)
    }
  }
  await rm(DAEMON_CONFIG_FILE, {force: true}).catch(() => undefined)
}
