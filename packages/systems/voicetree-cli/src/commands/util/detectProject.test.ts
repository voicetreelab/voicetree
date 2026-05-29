import {mkdtempSync, mkdirSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {detectProjectFromCwd, resolveProject, ProjectNotDetectedError} from './detectProject'

const tmpDirs: string[] = []

function makeTmpDir(): string {
    const dir: string = mkdtempSync(join(tmpdir(), 'detect-project-'))
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

describe('detectProjectFromCwd', () => {
    it('returns the nearest ancestor project when cwd is nested inside it', () => {
        const tmpDir: string = makeTmpDir()
        const projectRoot: string = makeProject(join(tmpDir, 'workspace'))
        const nestedDir: string = join(projectRoot, 'notes', 'deep')
        mkdirSync(nestedDir, {recursive: true})

        expect(detectProjectFromCwd(nestedDir)).toBe(projectRoot)
    })

    it('returns the cwd when it is already the project root', () => {
        const tmpDir: string = makeTmpDir()
        const projectRoot: string = makeProject(join(tmpDir, 'workspace'))

        expect(detectProjectFromCwd(projectRoot)).toBe(projectRoot)
    })

    it('returns null when no ancestor contains a .voicetree marker', () => {
        const tmpDir: string = makeTmpDir()
        const nestedDir: string = join(tmpDir, 'plain', 'folder')
        mkdirSync(nestedDir, {recursive: true})

        expect(detectProjectFromCwd(nestedDir)).toBeNull()
    })

    it('prefers the innermost project when projects are nested', () => {
        const tmpDir: string = makeTmpDir()
        const outerProject: string = makeProject(join(tmpDir, 'outer'))
        const innerProject: string = makeProject(join(outerProject, 'projects', 'inner'))
        const nestedDir: string = join(innerProject, 'drafts')
        mkdirSync(nestedDir, {recursive: true})

        expect(detectProjectFromCwd(nestedDir)).toBe(innerProject)
    })
})

describe('resolveProject', () => {
    it('returns the explicit --project override when it points at a valid project', () => {
        const tmpDir: string = makeTmpDir()
        const projectRoot: string = makeProject(join(tmpDir, 'workspace'))

        expect(resolveProject({flag: projectRoot, cwd: tmpDir})).toBe(projectRoot)
    })

    it('resolves relative --project overrides from cwd before validating them', () => {
        const tmpDir: string = makeTmpDir()
        const projectRoot: string = makeProject(join(tmpDir, 'workspace'))

        expect(resolveProject({flag: './workspace', cwd: tmpDir})).toBe(projectRoot)
    })

    it('falls back to cwd detection when no --project override is provided', () => {
        const tmpDir: string = makeTmpDir()
        const projectRoot: string = makeProject(join(tmpDir, 'workspace'))
        const nestedDir: string = join(projectRoot, 'notes')
        mkdirSync(nestedDir, {recursive: true})

        expect(resolveProject({cwd: nestedDir})).toBe(projectRoot)
    })

    it('throws a typed error when --project does not point at a valid project root', () => {
        const tmpDir: string = makeTmpDir()
        const invalidPath: string = join(tmpDir, 'not-a-project')
        mkdirSync(invalidPath, {recursive: true})
        const call = (): string => resolveProject({flag: invalidPath, cwd: tmpDir})

        expect(call).toThrowError(ProjectNotDetectedError)
        expect(call).toThrow('.voicetree/')
    })

    it('throws a typed error with guidance when neither flag nor cwd resolves a project', () => {
        const tmpDir: string = makeTmpDir()
        const nestedDir: string = join(tmpDir, 'plain', 'folder')
        mkdirSync(nestedDir, {recursive: true})
        const call = (): string => resolveProject({cwd: nestedDir})

        expect(call).toThrowError(ProjectNotDetectedError)
        expect(call).toThrow('No project found. Run inside a project directory, or pass --project <path>.')
    })
})
