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
    let voicetreeHomePath: string
    let watchedDir: string
    let writeFolderPath: string

    beforeEach(async () => {
        root = await mkdtemp(path.join(tmpdir(), 'resolve-vault-config-'))
        voicetreeHomePath = path.join(root, 'app-support')
        watchedDir = path.join(root, 'project')
        writeFolderPath = path.join(watchedDir, 'voicetree')
        await mkdir(writeFolderPath, { recursive: true })
        process.env.VOICETREE_HOME_PATH = voicetreeHomePath
        await saveVaultConfigForDirectory(watchedDir, { writeFolderPath })
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
            allowlist: [writeFolderPath],
            writeFolderPath,
        })

        expect(getExpandedFolderPathsForVault).not.toHaveBeenCalled()
    })
})
