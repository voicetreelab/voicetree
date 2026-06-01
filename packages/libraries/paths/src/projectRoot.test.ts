import {mkdirSync, mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {detectProjectFromCwd, hasVoicetreeMarker, resolveProjectRoot} from './projectRoot.ts'

const tmpDirs: string[] = []

function makeTmpDir(): string {
    const dir: string = mkdtempSync(join(tmpdir(), 'project-root-'))
    tmpDirs.push(dir)
    return dir
}

function makeProject(rootPath: string): string {
    mkdirSync(join(rootPath, '.voicetree'), {recursive: true})
    return rootPath
}

afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
    }
})

describe('hasVoicetreeMarker', () => {
    it('is true for a directory containing .voicetree/ and false otherwise', () => {
        const tmpDir: string = makeTmpDir()
        const project: string = makeProject(join(tmpDir, 'proj'))
        const plain: string = join(tmpDir, 'plain')
        mkdirSync(plain, {recursive: true})

        expect(hasVoicetreeMarker(project)).toBe(true)
        expect(hasVoicetreeMarker(plain)).toBe(false)
    })
})

describe('detectProjectFromCwd', () => {
    it('climbs to the innermost ancestor project root', () => {
        const tmpDir: string = makeTmpDir()
        const outer: string = makeProject(join(tmpDir, 'outer'))
        const inner: string = makeProject(join(outer, 'inner'))
        const nested: string = join(inner, 'a', 'b')
        mkdirSync(nested, {recursive: true})

        expect(detectProjectFromCwd(nested)).toBe(inner)
    })

    it('returns null when no ancestor is a project root', () => {
        const tmpDir: string = makeTmpDir()
        const plain: string = join(tmpDir, 'x', 'y')
        mkdirSync(plain, {recursive: true})

        expect(detectProjectFromCwd(plain)).toBeNull()
    })
})

describe('resolveProjectRoot', () => {
    it('prefers $VOICETREE_PROJECT_PATH over the inner project the cwd up-walk would find', () => {
        const tmpDir: string = makeTmpDir()
        const outer: string = makeProject(join(tmpDir, 'outer'))
        const inner: string = makeProject(join(outer, 'sub'))
        const nested: string = join(inner, 'notes')
        mkdirSync(nested, {recursive: true})

        expect(resolveProjectRoot({cwd: nested, env: {VOICETREE_PROJECT_PATH: outer}})).toBe(outer)
    })

    it('falls back to the cwd up-walk when the env var is unset', () => {
        const tmpDir: string = makeTmpDir()
        const project: string = makeProject(join(tmpDir, 'proj'))
        const nested: string = join(project, 'notes')
        mkdirSync(nested, {recursive: true})

        expect(resolveProjectRoot({cwd: nested, env: {}})).toBe(project)
    })

    it('ignores an env var that does not name a project root', () => {
        const tmpDir: string = makeTmpDir()
        const project: string = makeProject(join(tmpDir, 'proj'))
        const nested: string = join(project, 'notes')
        mkdirSync(nested, {recursive: true})
        const notAProject: string = join(tmpDir, 'nope')
        mkdirSync(notAProject, {recursive: true})

        expect(resolveProjectRoot({cwd: nested, env: {VOICETREE_PROJECT_PATH: notAProject}})).toBe(project)
    })

    it('returns null when neither the env var nor the cwd up-walk resolves a project', () => {
        const tmpDir: string = makeTmpDir()
        const plain: string = join(tmpDir, 'plain')
        mkdirSync(plain, {recursive: true})

        expect(resolveProjectRoot({cwd: plain, env: {}})).toBeNull()
    })
})
