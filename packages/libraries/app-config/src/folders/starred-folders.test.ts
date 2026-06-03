import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {VOICETREE_HOME_PATH_ENV} from '@vt/paths'
import {SETTINGS_FILENAME} from '../config-files.ts'
import {addStarredFolder, getStarredFolders, isStarred, removeStarredFolder} from './starred-folders.ts'

// Black-box: drive the public API and assert on what the next read observes —
// the starred list is persisted to settings.json under a temp VOICETREE_HOME.
let home: string
let priorHome: string | undefined

beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'starred-home-'))
    priorHome = process.env[VOICETREE_HOME_PATH_ENV]
    process.env[VOICETREE_HOME_PATH_ENV] = home
    // Seed an empty starred list so the baseline is deterministic (DEFAULT_SETTINGS
    // otherwise seeds ~/brain/workflows).
    writeFileSync(path.join(home, SETTINGS_FILENAME), JSON.stringify({starredFolders: []}))
})
afterEach(() => {
    if (priorHome === undefined) delete process.env[VOICETREE_HOME_PATH_ENV]
    else process.env[VOICETREE_HOME_PATH_ENV] = priorHome
    rmSync(home, {recursive: true, force: true})
})

describe('starred folders', () => {
    it('starts empty', async () => {
        expect(await getStarredFolders()).toEqual([])
        expect(await isStarred('/p/a')).toBe(false)
    })

    it('adds a folder and surfaces it on the next read', async () => {
        await addStarredFolder('/p/a')
        expect(await getStarredFolders()).toEqual(['/p/a'])
        expect(await isStarred('/p/a')).toBe(true)
    })

    it('does not duplicate an already-starred folder', async () => {
        await addStarredFolder('/p/a')
        await addStarredFolder('/p/a')
        expect(await getStarredFolders()).toEqual(['/p/a'])
    })

    it('removes only the named folder, preserving the rest', async () => {
        await addStarredFolder('/p/a')
        await addStarredFolder('/p/b')
        await removeStarredFolder('/p/a')
        expect(await getStarredFolders()).toEqual(['/p/b'])
        expect(await isStarred('/p/a')).toBe(false)
    })
})
