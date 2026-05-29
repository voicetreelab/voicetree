import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => process.env.VOICETREE_HOME_PATH ?? os.tmpdir()),
    },
}))

import { saveLastDirectory } from '@vt/app-config/project-config'
import { setStartupFolderOverride } from '@/shell/edge/main/runtime/electron/startup/startup-folder-override'
import { getStartupProjectHint } from './openProject'

describe('getStartupProjectHint', () => {
    let voicetreeHomePath: string

    beforeEach(async () => {
        voicetreeHomePath = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-startup-hint-'))
        process.env.VOICETREE_HOME_PATH = voicetreeHomePath
        setStartupFolderOverride(null)
    })

    afterEach(async () => {
        setStartupFolderOverride(null)
        delete process.env.VOICETREE_HOME_PATH
        await fs.rm(voicetreeHomePath, { recursive: true, force: true })
    })

    it('does not turn persisted lastDirectory into a startup auto-open hint', async () => {
        const projectPath: string = path.join(voicetreeHomePath, 'project')
        await fs.mkdir(projectPath)
        await saveLastDirectory(projectPath)

        await expect(getStartupProjectHint()).resolves.toEqual({ kind: 'none' })
    })

    it('returns an explicit startup folder override', async () => {
        const projectPath: string = path.join(voicetreeHomePath, 'project')
        setStartupFolderOverride(projectPath)

        await expect(getStartupProjectHint()).resolves.toEqual({
            kind: 'open-folder',
            path: projectPath,
        })
    })
})
