import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getExpandedFolderPathsForProject } = vi.hoisted(() => ({
    getExpandedFolderPathsForProject: vi.fn(),
}))

vi.mock('../folder-visibility-active-view', () => ({
    getExpandedFolderPathsForProject,
}))

import { resolveAllowlistForProject } from '../paths/resolve-project-config'
import { saveProjectConfigForDirectory } from '@vt/app-config/project-config'

describe('resolveAllowlistForProject', () => {
    let root: string
    let voicetreeHomePath: string
    let watchedDir: string
    let writeFolderPath: string

    beforeEach(async () => {
        root = await mkdtemp(path.join(tmpdir(), 'resolve-project-config-'))
        voicetreeHomePath = path.join(root, 'voicetree-home')
        watchedDir = path.join(root, 'project')
        writeFolderPath = path.join(watchedDir, 'voicetree')
        await mkdir(writeFolderPath, { recursive: true })
        process.env.VOICETREE_HOME_PATH = voicetreeHomePath
        await saveProjectConfigForDirectory(watchedDir, { writeFolderPath })
        getExpandedFolderPathsForProject.mockResolvedValue([path.join(watchedDir, 'external')])
    })

    afterEach(async () => {
        await rm(root, { recursive: true, force: true })
        getExpandedFolderPathsForProject.mockReset()
    })

    it('can skip active-view sqlite reads for Electron main daemon handoff', async () => {
        await expect(
            resolveAllowlistForProject(watchedDir, { includeActiveViewExpandedPaths: false }),
        ).resolves.toEqual({
            allowlist: [writeFolderPath],
            writeFolderPath,
        })

        expect(getExpandedFolderPathsForProject).not.toHaveBeenCalled()
    })
})
