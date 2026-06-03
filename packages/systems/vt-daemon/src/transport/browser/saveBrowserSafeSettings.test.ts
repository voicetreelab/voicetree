// Black-box tests for the browser-mode settings WRITE path. The observable side
// effect is the on-disk settings.json — so we drive a real temp $VOICETREE_HOME,
// call the public functions, and assert on what actually lands on disk. No
// internal mocking, no toHaveBeenCalledWith.

import {promises as fs} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createDefaultSettings} from '@vt/graph-model/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {VOICETREE_HOME_PATH_ENV} from '@vt/paths'
import {
    loadSettings,
    mergeBrowserSafeSettings,
    saveBrowserSafeSettings,
    saveSettings,
} from './settings_IO.ts'

let homeDir: string
let originalEnv: string | undefined

async function readSettingsFromDisk(): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(path.join(homeDir, 'settings.json'), 'utf-8')
    return JSON.parse(raw) as Record<string, unknown>
}

describe('saveBrowserSafeSettings (write-side allowlist, on disk)', () => {
    beforeEach(async () => {
        homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-settings-write-'))
        originalEnv = process.env[VOICETREE_HOME_PATH_ENV]
        process.env[VOICETREE_HOME_PATH_ENV] = homeDir
    })

    afterEach(async () => {
        await fs.rm(homeDir, {recursive: true, force: true})
        if (originalEnv === undefined) delete process.env[VOICETREE_HOME_PATH_ENV]
        else process.env[VOICETREE_HOME_PATH_ENV] = originalEnv
    })

    it('persists allowlisted fields to disk', async () => {
        await saveSettings(createDefaultSettings())

        await saveBrowserSafeSettings({darkMode: true, vimMode: true, contextMaxChars: 4242})

        const onDisk = await readSettingsFromDisk()
        expect(onDisk.darkMode).toBe(true)
        expect(onDisk.vimMode).toBe(true)
        expect(onDisk.contextMaxChars).toBe(4242)
    })

    it('NEVER writes INJECT_ENV_VARS supplied by the browser — secrets on disk survive untouched', async () => {
        const existing: VTSettings = {
            ...createDefaultSettings(),
            INJECT_ENV_VARS: {ANTHROPIC_API_KEY: 'sk-keep-me'},
        }
        await saveSettings(existing)

        await saveBrowserSafeSettings({
            INJECT_ENV_VARS: {ANTHROPIC_API_KEY: 'sk-attacker-overwrite', LEAKED: 'pwned'},
            darkMode: true,
        } as Partial<VTSettings>)

        const onDisk = await readSettingsFromDisk()
        // The allowlisted field landed...
        expect(onDisk.darkMode).toBe(true)
        // ...the pre-existing secret survives (loadSettings deep-merges defaults
        // into INJECT_ENV_VARS, so other default keys may also be present — what
        // matters is the existing secret is kept)...
        expect((onDisk.INJECT_ENV_VARS as Record<string, unknown>).ANTHROPIC_API_KEY).toBe('sk-keep-me')
        // ...and NOTHING the browser tried to inject reached disk.
        const serialized = JSON.stringify(onDisk)
        expect(serialized).not.toContain('sk-attacker-overwrite')
        expect(serialized).not.toContain('pwned')
        expect((onDisk.INJECT_ENV_VARS as Record<string, unknown>).LEAKED).toBeUndefined()
    })

    it('NEVER writes hooks/shell (host concerns) supplied by the browser', async () => {
        await saveSettings({
            ...createDefaultSettings(),
            hooks: {onNewNode: 'echo legit'},
            shell: '/bin/zsh',
        })

        await saveBrowserSafeSettings({
            hooks: {onNewNode: 'rm -rf /'},
            shell: '/evil/shell',
            darkMode: true,
        } as Partial<VTSettings>)

        const onDisk = await readSettingsFromDisk()
        expect(onDisk.darkMode).toBe(true)
        // Pre-existing host fields are preserved, the browser's are ignored.
        expect(onDisk.hooks).toEqual({onNewNode: 'echo legit'})
        expect(onDisk.shell).toBe('/bin/zsh')
        expect(JSON.stringify(onDisk)).not.toContain('rm -rf /')
    })

    it('returns the browser-safe projection of the saved result (no secrets echoed back)', async () => {
        await saveSettings({
            ...createDefaultSettings(),
            INJECT_ENV_VARS: {ANTHROPIC_API_KEY: 'sk-keep-me'},
        })

        const result = await saveBrowserSafeSettings({darkMode: true})

        expect(result.darkMode).toBe(true)
        expect(result.INJECT_ENV_VARS).toEqual({})
        // And it round-trips: loadSettings now reflects the persisted change.
        expect((await loadSettings()).darkMode).toBe(true)
    })
})

describe('mergeBrowserSafeSettings (pure)', () => {
    it('keeps current secret/host fields and drops them from the incoming patch', () => {
        const current: VTSettings = {
            ...createDefaultSettings(),
            INJECT_ENV_VARS: {SECRET: 'keep'},
            hooks: {onNewNode: 'keep-hook'},
            shell: '/bin/keep',
        }

        const merged = mergeBrowserSafeSettings(current, {
            INJECT_ENV_VARS: {SECRET: 'overwrite', EXTRA: 'leak'},
            hooks: {onNewNode: 'evil'},
            shell: '/bin/evil',
            darkMode: true,
        } as Partial<VTSettings>)

        expect(merged.darkMode).toBe(true)
        expect(merged.INJECT_ENV_VARS).toEqual({SECRET: 'keep'})
        expect(merged.hooks).toEqual({onNewNode: 'keep-hook'})
        expect(merged.shell).toBe('/bin/keep')
    })

    it('ignores unknown keys entirely (fail-closed)', () => {
        const current = createDefaultSettings()
        const merged = mergeBrowserSafeSettings(
            current,
            {totallyUnknownField: 'x'} as unknown as Partial<VTSettings>,
        )
        expect('totallyUnknownField' in merged).toBe(false)
    })
})
