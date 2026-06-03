/**
 * Helpers for the browser VoiceTree daemon-integration Playwright tier.
 *
 * Daemons are booted by globalSetup (real `vt serve` via @vt/daemon-test-harness),
 * which writes their URL + bearer token to DAEMON_CONFIG_FILE. Tests load that
 * via `loadDaemonConfig()` — there is NO env-gated self-skip: if the config file
 * is absent the loader throws, so a misconfigured run fails loudly instead of
 * silently passing zero assertions (the gap that hid the terminal protocol bug).
 *
 * No CORS interception: under the VTD-gateway model the browser talks ONLY to
 * VTD, which emits native CORS for the origins in VOICETREE_CORS_ORIGINS
 * (set by globalSetup for the fixed web port). The path under proof is real.
 */

import {readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {type Page} from '@playwright/test'

// Cross-process handoff written by globalSetup, read here in worker processes,
// removed by globalTeardown.
//
// Keyed by PLAYWRIGHT_PORT so distinct concurrent runs (e.g. parallel agents on
// different ports, or several slices sharing one checkout) write distinct
// handoff files instead of clobbering one another. globalSetup, the workers, and
// globalTeardown all run in processes that inherit PLAYWRIGHT_PORT for a given
// invocation, so they agree on the path.
//
// Lives in the OS temp dir, NOT webapp/test-results: Playwright wipes its output
// directory (test-results) at the START of every run, so a concurrent run on a
// different port starting mid-flight would delete THIS run's handoff file there
// and strand its workers with "daemon-config not found". The OS temp dir is
// outside Playwright's purview, so per-port concurrent runs in one checkout are
// genuinely isolated — the whole point of keying by port.
const HANDOFF_PORT: string = process.env.PLAYWRIGHT_PORT ?? '3100'
export const DAEMON_CONFIG_FILE: string = join(
  tmpdir(),
  `vt-browser-daemon-config-${HANDOFF_PORT}.json`,
)

export interface BrowserDaemonTestConfig {
  readonly vtdUrl: string
  readonly vtdToken: string
  readonly projectPath: string
}

/**
 * Load the live daemon config globalSetup wrote. Throws if absent — the tier
 * MUST run against real daemons, never self-skip.
 */
export function loadDaemonConfig(): BrowserDaemonTestConfig {
  let raw: string
  try {
    raw = readFileSync(DAEMON_CONFIG_FILE, 'utf8')
  } catch {
    throw new Error(
      `[daemon_integration] daemon-config not found at ${DAEMON_CONFIG_FILE}. `
      + 'globalSetup must boot `vt serve` before tests run — never self-skip.',
    )
  }
  const cfg = JSON.parse(raw) as Record<string, unknown>
  const {vtdUrl, vtdToken, projectPath} = cfg
  if (typeof vtdUrl !== 'string' || typeof vtdToken !== 'string' || typeof projectPath !== 'string') {
    throw new Error(`[daemon_integration] malformed daemon-config: ${raw}`)
  }
  return {vtdUrl, vtdToken, projectPath}
}

/** Inject the daemon config so the browser runtime installs window.hostAPI. */
export async function injectConfig(page: Page, cfg: BrowserDaemonTestConfig): Promise<void> {
  await page.addInitScript((config) => {
    (window as unknown as Record<string, unknown>).__VT_BROWSER_CONFIG__ = config
  }, cfg)
}

export async function waitForHostApiReady(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as {hostAPI?: unknown}).hostAPI !== undefined,
    {timeout: timeoutMs},
  )
}

export async function waitForCytoscapeReady(page: Page, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as {cytoscapeInstance?: unknown}).cytoscapeInstance !== undefined,
    {timeout: timeoutMs},
  )
}
