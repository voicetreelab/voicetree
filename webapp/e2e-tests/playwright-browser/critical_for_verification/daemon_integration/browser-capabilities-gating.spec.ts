/**
 * Browser VoiceTree — runtime capabilities + gated-control absence.
 *
 * The browser adapter advertises a capability record (runtimeCapabilities.ts)
 * that is the SINGLE source of truth the UI gates native-only controls on. This
 * tier asserts:
 *   (1) window.hostAPI.capabilities exactly matches the browser profile — every
 *       native-only flag false, every gateway-backed flag true; and
 *   (2) a gated control is genuinely ABSENT from the DOM (not merely disabled):
 *       the FolderTreeSidebar renders its ungated "New voicetree" button but NOT
 *       the native-folder-picker "Browse..." button.
 *
 * Together these prove the gate's source of truth and one end-to-end DOM effect.
 */

import {test, expect} from '@playwright/test'
import {loadDaemonConfig, injectConfig, waitForHostApiReady} from './vt-e2e-helpers.ts'

// The expected browser-mode capability profile (BROWSER_CAPABILITIES). Kept here
// as the test's own expectation so a regression that flips a flag fails loudly.
const EXPECTED_BROWSER_CAPABILITIES = {
    nativeFolderPicker: false,
    worktrees: true,
    clipboardImages: true,
    settingsPersistence: true,
    projectSwitching: false,
    usageObservability: false,
    nativeMicrophoneSettings: false,
    askMode: false,
} as const

test.describe('Browser VoiceTree — capabilities & gated-control absence', () => {

    test('window.hostAPI.capabilities matches the browser profile exactly', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        const caps = await page.evaluate(
            () => (window as unknown as {hostAPI: {capabilities: unknown}}).hostAPI.capabilities,
        )
        expect(caps).toEqual(EXPECTED_BROWSER_CAPABILITIES)
    })

    test('native folder-picker control is absent from the DOM (ungated control present)', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        await page.evaluate(async (projectPath) => {
            const api = (window as unknown as {hostAPI: {main: {openProject: (p: string) => Promise<unknown>}}}).hostAPI
            await api.main.openProject(projectPath)
        }, cfg.projectPath)

        // The sidebar footer always renders "New voicetree"; the native picker
        // "Browse..." is gated on nativeFolderPicker (false in browser mode).
        const newVoicetree = page.getByRole('button', {name: 'New voicetree'})
        await expect(newVoicetree).toBeVisible({timeout: 15_000})

        const browseButton = page.getByRole('button', {name: 'Browse...'})
        await expect(browseButton).toHaveCount(0)
    })

})
