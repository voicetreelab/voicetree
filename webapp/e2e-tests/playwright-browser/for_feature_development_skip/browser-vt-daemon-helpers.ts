/**
 * Shared helpers for browser VoiceTree direct-daemon Playwright tests.
 *
 * Design notes:
 * - injectCorsHeaders uses route.continue() for SSE routes because Playwright's
 *   route.fetch() buffers the full response body before returning, which deadlocks
 *   SSE streams that never close. --disable-web-security in the browser config lets
 *   the browser accept SSE responses from old daemons without CORS headers.
 * - CORS header injection for regular requests simulates what natively CORS-enabled
 *   daemons would provide. CORS enforcement is unit-tested in corsHeaders.test.ts.
 */

import { type Page, type Route } from '@playwright/test'

export type DaemonConfig = {
  readonly vtdUrl: string
  readonly vtdToken: string
  readonly graphdUrl: string
  readonly projectPath: string
}

export const SKIP_MSG = 'Browser daemon test skipped — set VT_TEST_VTD_URL/TOKEN/GRAPHD_URL/PROJECT_PATH'

export function skipIfNoDaemons(): DaemonConfig | null {
  const vtdUrl = process.env['VT_TEST_VTD_URL'] ?? null
  const vtdToken = process.env['VT_TEST_VTD_TOKEN'] ?? null
  const graphdUrl = process.env['VT_TEST_GRAPHD_URL'] ?? null
  const projectPath = process.env['VT_TEST_PROJECT_PATH'] ?? null
  if (!vtdUrl || !vtdToken || !graphdUrl || !projectPath) return null
  return { vtdUrl, vtdToken, graphdUrl, projectPath }
}

export async function injectConfig(page: Page, cfg: DaemonConfig): Promise<void> {
  await page.addInitScript((config) => {
    (window as unknown as Record<string, unknown>).__VT_BROWSER_CONFIG__ = config
  }, cfg)
}

/** SSE endpoints that stream indefinitely and cannot be proxied via route.fetch(). */
const SSE_SUFFIXES = ['/terminal-registry', '/events'] as const

function isSseRoute(url: string): boolean {
  try {
    const pathname = new URL(url).pathname
    return SSE_SUFFIXES.some(s => pathname.endsWith(s))
  } catch { return false }
}

/**
 * Intercept daemon requests and inject CORS headers for non-SSE routes.
 * For SSE routes, use route.continue() — see module comment for rationale.
 */
export async function injectCorsHeaders(
  page: Page,
  origin: string,
  daemonUrls: string[],
): Promise<void> {
  for (const url of daemonUrls) {
    await page.route(`${url}/**`, async (route: Route) => {
      if (isSseRoute(route.request().url())) {
        await route.continue().catch(() => {})
        return
      }
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Session-Id',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            'Access-Control-Max-Age': '86400',
          },
        }).catch(() => {})
        return
      }
      try {
        const response = await route.fetch()
        const headers: Record<string, string> = {}
        for (const [k, v] of Object.entries(response.headers())) {
          headers[k] = v
        }
        headers['Access-Control-Allow-Origin'] = origin
        await route.fulfill({ response, headers })
      } catch {
        // page/context closed mid-flight (common for long-lived routes)
      }
    })
  }
}

export async function waitForElectronApiReady(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { electronAPI?: unknown }).electronAPI !== undefined,
    { timeout: timeoutMs },
  )
}

export async function waitForCytoscapeReady(page: Page, timeoutMs = 20_000): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { cytoscapeInstance?: unknown }).cytoscapeInstance !== undefined,
    { timeout: timeoutMs },
  )
}
