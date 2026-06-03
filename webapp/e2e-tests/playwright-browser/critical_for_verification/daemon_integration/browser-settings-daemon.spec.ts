/**
 * Browser VoiceTree — settings load/persist gateway (daemon round-trip).
 *
 * Proves the no-Electron settings flow end-to-end against the REAL daemons
 * booted by globalSetup: Chrome → window.hostAPI (browserRuntime.ts) →
 * VTD GET/POST /settings → $VOICETREE_HOME/settings.json. Assertions are
 * observable: a saved field survives a full client reload (a fresh GET that
 * re-reads disk), and the security allowlist drops secret fields both from the
 * projection the browser can read AND from the on-disk file.
 */

import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {test, expect} from '@playwright/test'
import {loadDaemonConfig, injectConfig, waitForHostApiReady, DAEMON_CONFIG_FILE} from './vt-e2e-helpers.ts'

// VTSettings is wide; we touch only the browser-safe fields this test edits.
interface SettingsView {
    readonly vimMode?: boolean
    readonly nodeLineLimit?: number
    readonly siliconValleyMode?: boolean
    readonly INJECT_ENV_VARS?: Record<string, string>
    readonly [k: string]: unknown
}
interface SettingsMain {
    readonly loadSettings: () => Promise<SettingsView>
    readonly saveSettings: (s: SettingsView) => Promise<boolean>
}
type SettingsWindow = {hostAPI: {main: SettingsMain}}

// globalSetup writes the daemon's home path alongside the browser config.
function daemonHomePath(): string {
    const raw = JSON.parse(readFileSync(DAEMON_CONFIG_FILE, 'utf8')) as {homePath?: string}
    if (typeof raw.homePath !== 'string') throw new Error('daemon-config missing homePath')
    return raw.homePath
}

test.describe('Browser VoiceTree — settings gateway (daemon round-trip)', () => {

    test('load → edit → persist → reload: an allowlisted field survives a reload', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        // Edit two allowlisted fields (a boolean and a number) to distinct values.
        const saved = await page.evaluate(async () => {
            const main = (window as unknown as SettingsWindow).hostAPI.main
            const current = await main.loadSettings()
            const nextVim = !(current.vimMode ?? false)
            const nextLimit = (current.nodeLineLimit ?? 80) === 123 ? 124 : 123
            const ok = await main.saveSettings({...current, vimMode: nextVim, nodeLineLimit: nextLimit})
            return {ok, nextVim, nextLimit}
        })
        expect(saved.ok).toBe(true)

        // Full client reload: a fresh runtime, a fresh GET /settings off disk.
        await page.goto('/')
        await waitForHostApiReady(page)
        const reloaded = await page.evaluate(
            () => (window as unknown as SettingsWindow).hostAPI.main.loadSettings(),
        )
        expect(reloaded.vimMode).toBe(saved.nextVim)
        expect(reloaded.nodeLineLimit).toBe(saved.nextLimit)

        // On-disk parity: the daemon wrote the same values to settings.json.
        const settingsPath = join(daemonHomePath(), 'settings.json')
        expect(existsSync(settingsPath), 'settings.json must exist after a save').toBe(true)
        const onDisk = JSON.parse(readFileSync(settingsPath, 'utf8')) as SettingsView
        expect(onDisk.vimMode).toBe(saved.nextVim)
        expect(onDisk.nodeLineLimit).toBe(saved.nextLimit)
    })

    test('write-allowlist: a secret field (INJECT_ENV_VARS) is dropped, not persisted', async ({page}) => {
        const cfg = loadDaemonConfig()
        await injectConfig(page, cfg)
        await page.goto('/')
        await waitForHostApiReady(page)

        const secretKey = `EVIL_SECRET_${Date.now()}`

        const saved = await page.evaluate(async (secretKey) => {
            const main = (window as unknown as SettingsWindow).hostAPI.main
            const current = await main.loadSettings()
            const nextSilicon = !(current.siliconValleyMode ?? false)
            // Attempt to smuggle a secret in alongside a legitimate allowlisted edit.
            const ok = await main.saveSettings({
                ...current,
                siliconValleyMode: nextSilicon,
                INJECT_ENV_VARS: {[secretKey]: 'pwned'},
            })
            return {ok, nextSilicon}
        }, secretKey)
        expect(saved.ok).toBe(true)

        // Reload: the allowlisted edit took; the secret never reaches the browser.
        await page.goto('/')
        await waitForHostApiReady(page)
        const reloaded = await page.evaluate(
            () => (window as unknown as SettingsWindow).hostAPI.main.loadSettings(),
        )
        expect(reloaded.siliconValleyMode).toBe(saved.nextSilicon)
        expect(Object.keys(reloaded.INJECT_ENV_VARS ?? {})).not.toContain(secretKey)

        // On-disk: the secret was never written to settings.json.
        const onDisk = JSON.parse(readFileSync(join(daemonHomePath(), 'settings.json'), 'utf8')) as SettingsView
        expect(Object.keys(onDisk.INJECT_ENV_VARS ?? {}), 'secret must never hit disk').not.toContain(secretKey)
        expect(onDisk.siliconValleyMode).toBe(saved.nextSilicon)
    })

})
