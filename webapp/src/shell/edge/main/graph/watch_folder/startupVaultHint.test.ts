import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => process.env.VOICETREE_APP_SUPPORT ?? os.tmpdir()),
    },
}))

import { saveLastDirectory } from '@vt/app-config/vault-config'
import { setStartupFolderOverride } from '@/shell/edge/main/runtime/electron/startup/startup-folder-override'
import { getStartupVaultHint } from './openVault'

describe('getStartupVaultHint', () => {
    let appSupportPath: string

    beforeEach(async () => {
        appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-startup-hint-'))
        process.env.VOICETREE_APP_SUPPORT = appSupportPath
        setStartupFolderOverride(null)
    })

    afterEach(async () => {
        setStartupFolderOverride(null)
        delete process.env.VOICETREE_APP_SUPPORT
        await fs.rm(appSupportPath, { recursive: true, force: true })
    })

    it('does not turn persisted lastDirectory into a startup auto-open hint', async () => {
        const projectPath: string = path.join(appSupportPath, 'project')
        await fs.mkdir(projectPath)
        await saveLastDirectory(projectPath)

        await expect(getStartupVaultHint()).resolves.toEqual({ kind: 'none' })
    })

    it('returns an explicit startup folder override', async () => {
        const projectPath: string = path.join(appSupportPath, 'project')
        setStartupFolderOverride(projectPath)

        await expect(getStartupVaultHint()).resolves.toEqual({
            kind: 'open-folder',
            path: projectPath,
        })
    })
})
