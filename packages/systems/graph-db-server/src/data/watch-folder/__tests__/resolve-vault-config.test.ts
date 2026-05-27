import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getExpandedFolderPathsForVault } = vi.hoisted(() => ({
    getExpandedFolderPathsForVault: vi.fn(),
}))

vi.mock('../folder-visibility-active-view', () => ({
    getExpandedFolderPathsForVault,
}))

import { resolveAllowlistForProject } from '../paths/resolve-vault-config'
import { saveVaultConfigForDirectory } from '@vt/app-config/vault-config'

describe('resolveAllowlistForProject', () => {
    let root: string
    let appSupportPath: string
    let watchedDir: string
    let writeFolder: string

    beforeEach(async () => {
        root = await mkdtemp(path.join(tmpdir(), 'resolve-vault-config-'))
        appSupportPath = path.join(root, 'app-support')
        watchedDir = path.join(root, 'project')
        writeFolder = path.join(watchedDir, 'voicetree')
        await mkdir(writeFolder, { recursive: true })
        process.env.VOICETREE_APP_SUPPORT = appSupportPath
        await saveVaultConfigForDirectory(watchedDir, { writeFolder })
        getExpandedFolderPathsForVault.mockResolvedValue([path.join(watchedDir, 'external')])
    })

    afterEach(async () => {
        await rm(root, { recursive: true, force: true })
        getExpandedFolderPathsForVault.mockReset()
    })

    it('can skip active-view sqlite reads for Electron main daemon handoff', async () => {
        await expect(
            resolveAllowlistForProject(watchedDir, { includeActiveViewExpandedPaths: false }),
        ).resolves.toEqual({
            allowlist: [writeFolder],
            writeFolder,
        })

        expect(getExpandedFolderPathsForVault).not.toHaveBeenCalled()
    })
})
