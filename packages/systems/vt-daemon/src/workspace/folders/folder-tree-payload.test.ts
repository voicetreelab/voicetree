import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
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
    // `root` is a real temp dir (see the suite-level beforeEach), so these tests
    // exercise the actual realpath canonicalisation rather than string matching.
    it('accepts the project root, a read path, and nested paths', async () => {
        mkdirSync(path.join(root, 'sub'))
        const state = stateOf()
        expect(await isPathWithinAllowlist(root, state)).toBe(true)
        expect(await isPathWithinAllowlist(path.join(root, 'sub'), state)).toBe(true)
        // A not-yet-created path under the root is still in-allowlist (write target).
        expect(await isPathWithinAllowlist(path.join(root, 'sub', 'new.png'), state)).toBe(true)
    })

    it('rejects a sibling whose name merely shares the root prefix', async () => {
        // `${root}-evil` string-starts-with `${root}` but is NOT nested under it.
        const sibling = `${root}-evil`
        mkdirSync(sibling)
        try {
            expect(await isPathWithinAllowlist(sibling, stateOf())).toBe(false)
        } finally {
            rmSync(sibling, {recursive: true, force: true})
        }
    })

    it('rejects a `..` traversal that escapes the root (naive startsWith would PASS it)', async () => {
        // `${root}/../<basename>` lexically starts with `${root}/` yet resolves OUTSIDE.
        const escape = path.join(root, '..', path.basename(root) + '-escape')
        mkdirSync(escape)
        try {
            expect(await isPathWithinAllowlist(escape, stateOf())).toBe(false)
        } finally {
            rmSync(escape, {recursive: true, force: true})
        }
    })

    it('rejects an in-root symlink that points OUTSIDE the allowlist', async () => {
        const outside = mkdtempSync(path.join(os.tmpdir(), 'folder-payload-outside-'))
        writeFileSync(path.join(outside, 'secret.txt'), 'sensitive')
        const link = path.join(root, 'link-out')
        symlinkSync(outside, link)
        try {
            // The symlink lives inside the root, but realpath resolves it out.
            expect(await isPathWithinAllowlist(link, stateOf())).toBe(false)
            expect(await isPathWithinAllowlist(path.join(link, 'secret.txt'), stateOf())).toBe(false)
        } finally {
            rmSync(link, {force: true})
            rmSync(outside, {recursive: true, force: true})
        }
    })

    it('fails closed on an empty allowlist (no open project)', async () => {
        const empty = stateOf({projectRoot: '', readPaths: [], writeFolderPath: ''})
        expect(await isPathWithinAllowlist(root, empty)).toBe(false)
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
