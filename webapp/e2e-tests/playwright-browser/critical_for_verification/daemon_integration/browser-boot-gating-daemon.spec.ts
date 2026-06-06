/**
 * Browser VoiceTree — boot cleanliness + capability gating (QA slice B).
 *
 * Two guards that complement the round-trip tier:
 *
 *   1. BOOT IS CLEAN: the mount-time recovery + unclaimed-tmux polls hit REAL
 *      VTD routes, not phantom ones. Regression cover for a6876d02d, which
 *      repointed refreshUnclaimedTmuxSessions at the real listUnclaimedTmuxSessions
 *      route — the old verbatim name threw `Unknown method` on every 10s poll.
 *      We capture the console and ALSO invoke both polls directly, asserting
 *      each resolves to an array and that NO `Unknown method` error is logged.
 *
 *   2. GATED CONTROLS ARE ABSENT: askMode is false in BROWSER_CAPABILITIES, so
 *      the Ask-mode pill must not render even though the rest of the transcribe
 *      control row does. The Surviving-Agents recovery panel renders only when
 *      discovery returns sessions; today it returns none, so the panel — and its
 *      (currently broken) Resume/Fork/Trash controls — are absent from the DOM.
 *      See the slice-B recovery verdict node for the reachability analysis.
 */

import {test, expect} from '@playwright/test'
import {
  loadDaemonConfig,
  injectConfig,
  waitForHostApiReady,
  waitForCytoscapeReady,
} from './vt-e2e-helpers.ts'

test.describe('Browser VoiceTree — boot cleanliness + gating', () => {

  test('boot polls hit real VTD routes — no "Unknown method" for recovery/unclaimed', async ({page}) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(err.message))

    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)
    await page.evaluate(async (projectPath) => {
      const api = (window as unknown as {hostAPI?: {main?: {openProject?: (p: string) => Promise<unknown>}}}).hostAPI
      await api?.main?.openProject?.(projectPath)
    }, cfg.projectPath)
    await waitForCytoscapeReady(page)

    // Invoke the exact two routes the renderer stores poll on mount. Both must
    // resolve to arrays — proving the route names are real (not `Unknown method`).
    const polls = await page.evaluate(async () => {
      const api = (window as unknown as {hostAPI?: {main?: {
        refreshUnclaimedTmuxSessions?: () => Promise<unknown>
        refreshRecoverySessions?: (h?: number | null) => Promise<unknown>
      }}}).hostAPI
      const unclaimed = await api?.main?.refreshUnclaimedTmuxSessions?.()
      const recovery = await api?.main?.refreshRecoverySessions?.()
      return {
        unclaimedIsArray: Array.isArray(unclaimed),
        recoveryIsArray: Array.isArray(recovery),
      }
    })

    expect(polls.unclaimedIsArray, 'refreshUnclaimedTmuxSessions must resolve to an array (real route)').toBe(true)
    expect(polls.recoveryIsArray, 'refreshRecoverySessions must resolve to an array (real route)').toBe(true)

    const unknownMethod = consoleErrors.filter((m) => /unknown method/i.test(m))
    expect(unknownMethod, `no "Unknown method" errors expected; saw: ${JSON.stringify(unknownMethod)}`).toEqual([])
  })

  test('gated controls absent: no Ask-mode pill, no Surviving-Agents recovery panel', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)
    await page.evaluate(async (projectPath) => {
      const api = (window as unknown as {hostAPI?: {main?: {openProject?: (p: string) => Promise<unknown>}}}).hostAPI
      await api?.main?.openProject?.(projectPath)
    }, cfg.projectPath)
    await waitForCytoscapeReady(page)

    // The browser runtime must report askMode disabled — the input that gates
    // the Ask pill. (Observable proof the BROWSER capability set is installed.)
    const askModeCap = await page.evaluate(
      () => (window as unknown as {hostAPI?: {capabilities?: {askMode?: boolean}}}).hostAPI?.capabilities?.askMode,
    )
    expect(askModeCap, 'browser runtime must report askMode = false').toBe(false)

    // Non-vacuous: the transcribe control row IS mounted (its mic button renders
    // the inline-block mic svg), so the absent Ask pill is gated out, not merely
    // un-rendered because the whole row is missing.
    await page.waitForSelector('button svg.inline-block', {timeout: 10_000})
    const micButtons = await page.locator('button:has(svg.inline-block)').count()
    expect(micButtons, 'transcribe control row (mic button) must be mounted').toBeGreaterThan(0)

    const askButtons = await page.getByRole('button', {name: 'Ask', exact: true}).count()
    expect(askButtons, 'gated Ask-mode pill must be absent in browser mode').toBe(0)

    // Surviving-Agents recovery panel: discovery returns no sessions today, so
    // the section (and its Resume/Fork/Trash controls) must be absent. This is
    // the DOM evidence for the reachability verdict — the panel is NOT
    // capability-gated, so it WILL render once discovery yields sessions.
    const recoveryPanels = await page.getByTestId('surviving-agents-section').count()
    expect(recoveryPanels, 'recovery panel must be absent while discovery returns no sessions').toBe(0)
  })

})
