import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {VOICETREE_HOME_PATH_ENV} from '@vt/paths'
import {SETTINGS_FILENAME} from '../config-files.ts'
import {addStarredFolder} from './starred-folders.ts'
import {
    buildFolderTreeSyncPayload,
    isPathWithinAllowlist,
    selectAvailableFolders,
    type FolderTreeProjectState,
} from './folder-tree-payload.ts'

let root: string
let home: string
let priorHome: string | undefined

beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'folder-payload-'))
    home = mkdtempSync(path.join(os.tmpdir(), 'folder-payload-home-'))
    priorHome = process.env[VOICETREE_HOME_PATH_ENV]
    process.env[VOICETREE_HOME_PATH_ENV] = home
    // Deterministic empty starred baseline (DEFAULT_SETTINGS seeds ~/brain/workflows).
    writeFileSync(path.join(home, SETTINGS_FILENAME), JSON.stringify({starredFolders: []}))
})
afterEach(() => {
    if (priorHome === undefined) delete process.env[VOICETREE_HOME_PATH_ENV]
    else process.env[VOICETREE_HOME_PATH_ENV] = priorHome
    rmSync(root, {recursive: true, force: true})
    rmSync(home, {recursive: true, force: true})
})

function stateOf(overrides: Partial<FolderTreeProjectState> = {}): FolderTreeProjectState {
    return {projectRoot: root, readPaths: [root], writeFolderPath: root, ...overrides}
}

describe('isPathWithinAllowlist', () => {
    const state = stateOf({projectRoot: '/proj', readPaths: ['/proj', '/ext/read'], writeFolderPath: '/proj'})

    it('accepts the project root, a read path, and nested paths', () => {
        expect(isPathWithinAllowlist('/proj', state)).toBe(true)
        expect(isPathWithinAllowlist('/proj/sub', state)).toBe(true)
        expect(isPathWithinAllowlist('/ext/read/deep', state)).toBe(true)
    })
    it('rejects anything outside every allowlisted root', () => {
        expect(isPathWithinAllowlist('/etc', state)).toBe(false)
        expect(isPathWithinAllowlist('/projector', state)).toBe(false) // prefix-but-not-nested
    })
})

describe('selectAvailableFolders', () => {
    it('returns project subfolders that are not already loaded', async () => {
        mkdirSync(path.join(root, 'notes'))
        mkdirSync(path.join(root, 'archive'))
        const result = await selectAvailableFolders(stateOf(), '')
        const display = result.map((f) => f.displayPath).sort()
        expect(display).toContain('notes')
        expect(display).toContain('archive')
    })

    it('refuses to browse an absolute path outside the allowlist', async () => {
        const outside = mkdtempSync(path.join(os.tmpdir(), 'outside-'))
        try {
            mkdirSync(path.join(outside, 'secret'))
            expect(await selectAvailableFolders(stateOf(), outside)).toEqual([])
        } finally {
            rmSync(outside, {recursive: true, force: true})
        }
    })

    it('returns [] when there is no project root', async () => {
        expect(await selectAvailableFolders(stateOf({projectRoot: ''}), '')).toEqual([])
    })
})

describe('buildFolderTreeSyncPayload', () => {
    it('builds the root tree and flags in-graph files', async () => {
        writeFileSync(path.join(root, 'a.md'), '# a')
        mkdirSync(path.join(root, 'sub'))
        const inGraph = new Set<string>([path.join(root, 'a.md')])

        const payload = await buildFolderTreeSyncPayload(stateOf(), inGraph)
        expect(payload.rootTree).not.toBeNull()
        expect(payload.rootTree?.children.map((c) => c.name).sort()).toEqual(['a.md', 'sub'])
        expect(payload.starredFolders).toEqual([])
        expect(payload.externalTrees).toEqual({})
    })

    it('includes a starred-folder tree once that folder is starred', async () => {
        const starred = path.join(root, 'starred')
        mkdirSync(starred)
        await addStarredFolder(starred)

        const payload = await buildFolderTreeSyncPayload(stateOf(), new Set<string>())
        expect(payload.starredFolders).toEqual([starred])
        expect(Object.keys(payload.starredTrees)).toEqual([starred])
    })

    it('surfaces read paths outside the project root as external trees', async () => {
        const external = mkdtempSync(path.join(os.tmpdir(), 'external-read-'))
        try {
            mkdirSync(path.join(external, 'docs'))
            const state = stateOf({readPaths: [root, external]})
            const payload = await buildFolderTreeSyncPayload(state, new Set<string>())
            expect(Object.keys(payload.externalTrees)).toEqual([external])
        } finally {
            rmSync(external, {recursive: true, force: true})
        }
    })
})
