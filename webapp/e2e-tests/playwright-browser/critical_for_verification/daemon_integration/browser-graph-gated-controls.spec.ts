/**
 * Browser VoiceTree — native-only controls are GATED OFF (daemon round-trip).
 *
 * Browser mode talks only to VTD and is pinned to one launched `--project`
 * daemon, so two native affordances must be absent — not merely disabled:
 *   - the native folder picker ("Browse..." → showFolderPicker)
 *   - project switching ("← Back to project selection")
 *
 * Proven on two levels:
 *   1. The capability SEAM — window.hostAPI.capabilities — is the browser
 *      profile (nativeFolderPicker:false, projectSwitching:false). This is the
 *      single source of truth every gate reads (runtimeCapabilities.ts).
 *   2. The rendered DOM omits the gated controls. Non-vacuous: the same panel's
 *      NON-gated sibling (the project-root button) IS present, so we are
 *      asserting against a live, rendered FileWatchingPanel — the gate took
 *      effect, the panel didn't simply fail to mount.
 */

import {test, expect} from '@playwright/test'
import {
  loadDaemonConfig,
  injectConfig,
  waitForHostApiReady,
  waitForCytoscapeReady,
} from './vt-e2e-helpers.ts'

test.describe('Browser VoiceTree — gated native controls', () => {

  test('capability seam advertises the browser profile (folder-picker + project-switching OFF)', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)

    const caps = await page.evaluate(() => {
      return (window as unknown as {hostAPI?: {capabilities?: Record<string, boolean>}}).hostAPI?.capabilities ?? null
    })

    expect(caps, 'browser hostAPI must expose a capabilities record').not.toBeNull()
    // The two this slice gates — must be OFF in browser mode.
    expect(caps!.nativeFolderPicker, 'native folder picker must be disabled in browser mode').toBe(false)
    expect(caps!.projectSwitching, 'project switching must be disabled in browser mode').toBe(false)
    // Sanity that this is the genuine browser profile, not an all-false stub:
    // VTD-gateway-backed capabilities remain ON.
    expect(caps!.worktrees, 'worktrees are VTD-served and must stay enabled').toBe(true)
    expect(caps!.clipboardImages, 'clipboard images are VTD-served and must stay enabled').toBe(true)
  })

  test('rendered DOM omits the folder picker and back-to-projects controls (sibling present)', async ({page}) => {
    const cfg = loadDaemonConfig()
    await injectConfig(page, cfg)
    await page.goto('/')
    await waitForHostApiReady(page)
    await page.evaluate(async (projectPath) => {
      const api = (window as unknown as {hostAPI?: {main?: {openProject?: (p: string) => Promise<unknown>}}}).hostAPI
      await api?.main?.openProject?.(projectPath)
    }, cfg.projectPath)
    await waitForCytoscapeReady(page)

    // Non-gated sibling in the SAME panel as the back button — proves the
    // FileWatchingPanel actually rendered, so the absence checks below are real.
    const projectRootButton = page.locator('[title^="Project root"]')
    await expect(projectRootButton, 'the (non-gated) project-root button must render — guards against a vacuous absence check').toBeVisible({timeout: 15_000})

    // Gated OFF: project switching back button.
    await expect(
      page.locator('[title="Back to project selection"]'),
      'browser mode must not render the back-to-projects control',
    ).toHaveCount(0)

    // Gated OFF: native folder picker.
    await expect(
      page.locator('[title="Browse and add external folder"]'),
      'browser mode must not render the native folder-picker control',
    ).toHaveCount(0)
  })

})
