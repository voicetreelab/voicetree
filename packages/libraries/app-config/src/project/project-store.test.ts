import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {mkdirSync, mkdtempSync, rmSync, symlinkSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {SavedProject} from '@vt/graph-model/project'
import {VOICETREE_HOME_PATH_ENV} from '@vt/paths'
import {dedupeProjectsByCanonicalPath, loadProjects, saveProject} from './project-store.ts'

function makeProject(overrides: Partial<SavedProject> & {readonly path: string}): SavedProject {
    return {
        id: overrides.id ?? `id:${overrides.path}`,
        path: overrides.path,
        name: overrides.name ?? path.basename(overrides.path),
        type: overrides.type ?? 'folder',
        lastOpened: overrides.lastOpened ?? 1,
    }
}

// Pure transform — fed an injected canonicalizer so the casing/symlink policy is
// asserted deterministically on every platform (the real, filesystem-dependent
// canonicalizer is `normalizeProjectPath`, covered in @vt/paths).
describe('dedupeProjectsByCanonicalPath', () => {
    const caseInsensitive: (projectPath: string) => string = (projectPath) => projectPath.toLowerCase()

    it('collapses entries that canonicalize equal, keeping the most-recently-opened one', () => {
        const older: SavedProject = makeProject({id: 'older', path: '/Users/x/Voicetree', lastOpened: 100})
        const newer: SavedProject = makeProject({id: 'newer', path: '/Users/x/voicetree', lastOpened: 200})

        const result: SavedProject[] = dedupeProjectsByCanonicalPath([older, newer], caseInsensitive)

        expect(result).toHaveLength(1)
        expect(result[0]?.id).toBe('newer')
    })

    it('chooses the most-recent winner regardless of input order', () => {
        const older: SavedProject = makeProject({id: 'older', path: '/p', lastOpened: 1})
        const newer: SavedProject = makeProject({id: 'newer', path: '/P', lastOpened: 2})

        expect(dedupeProjectsByCanonicalPath([older, newer], caseInsensitive)[0]?.id).toBe('newer')
        expect(dedupeProjectsByCanonicalPath([newer, older], caseInsensitive)[0]?.id).toBe('newer')
    })

    it('keeps genuinely distinct directories', () => {
        const alpha: SavedProject = makeProject({id: 'alpha', path: '/Users/x/alpha'})
        const beta: SavedProject = makeProject({id: 'beta', path: '/Users/x/beta'})

        const result: SavedProject[] = dedupeProjectsByCanonicalPath([alpha, beta], caseInsensitive)

        expect(result.map((p) => p.id).sort()).toEqual(['alpha', 'beta'])
    })
})

// Disk-level black-box tests: drive the real store against a temp VoiceTree home
// and assert on what `loadProjects` observes. Symlinks (not casing) stand in for
// "two paths, one directory" so the canonical collapse is deterministic on both
// case-insensitive (dev macOS) and case-sensitive (CI Linux) filesystems.
describe('project store (saveProject + loadProjects)', () => {
    let home: string
    let workspace: string
    let previousHome: string | undefined

    beforeEach(() => {
        home = mkdtempSync(path.join(os.tmpdir(), 'vt-home-'))
        workspace = mkdtempSync(path.join(os.tmpdir(), 'vt-workspace-'))
        previousHome = process.env[VOICETREE_HOME_PATH_ENV]
        process.env[VOICETREE_HOME_PATH_ENV] = home
    })

    afterEach(() => {
        if (previousHome === undefined) {
            delete process.env[VOICETREE_HOME_PATH_ENV]
        } else {
            process.env[VOICETREE_HOME_PATH_ENV] = previousHome
        }
        rmSync(home, {recursive: true, force: true})
        rmSync(workspace, {recursive: true, force: true})
    })

    it('round-trips a saved project', async () => {
        const dir: string = path.join(workspace, 'project')
        mkdirSync(dir)

        await saveProject(makeProject({id: 'p1', path: dir, lastOpened: 5}))

        const loaded: SavedProject[] = await loadProjects()
        expect(loaded).toHaveLength(1)
        expect(loaded[0]?.id).toBe('p1')
    })

    it('collapses two records that resolve to the same directory into one', async () => {
        const target: string = path.join(workspace, 'target')
        const alias: string = path.join(workspace, 'alias')
        mkdirSync(target)
        symlinkSync(target, alias)

        await saveProject(makeProject({id: 'via-target', path: target, lastOpened: 10}))
        await saveProject(makeProject({id: 'via-alias', path: alias, lastOpened: 20}))

        const loaded: SavedProject[] = await loadProjects()
        expect(loaded).toHaveLength(1)
        // The second save supersedes the first variant of the same directory.
        expect(loaded[0]?.id).toBe('via-alias')
    })

    it('updates a project in place when saved again under the same id', async () => {
        const dir: string = path.join(workspace, 'project')
        mkdirSync(dir)

        await saveProject(makeProject({id: 'p1', path: dir, name: 'first', lastOpened: 1}))
        await saveProject(makeProject({id: 'p1', path: dir, name: 'second', lastOpened: 2}))

        const loaded: SavedProject[] = await loadProjects()
        expect(loaded).toHaveLength(1)
        expect(loaded[0]?.name).toBe('second')
    })

    it('drops projects whose directory no longer exists', async () => {
        const dir: string = path.join(workspace, 'gone')
        mkdirSync(dir)
        await saveProject(makeProject({id: 'ghost', path: dir}))
        rmSync(dir, {recursive: true, force: true})

        expect(await loadProjects()).toHaveLength(0)
    })
})
