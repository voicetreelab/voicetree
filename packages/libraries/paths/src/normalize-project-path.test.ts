import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {normalizeProjectPath} from './paths.ts'

// Black-box tests against the real filesystem: `normalizeProjectPath` is an edge
// function whose whole job is to consult the OS, so it is exercised with real
// temp directories rather than a stubbed `fs`.
describe('normalizeProjectPath', () => {
    let base: string

    beforeEach(() => {
        base = mkdtempSync(path.join(os.tmpdir(), 'vt-normalize-'))
    })

    afterEach(() => {
        rmSync(base, {recursive: true, force: true})
    })

    it('returns the real on-disk path for an existing directory and is idempotent', () => {
        const dir: string = path.join(base, 'project')
        mkdirSync(dir)

        const normalized: string = normalizeProjectPath(dir)

        expect(path.isAbsolute(normalized)).toBe(true)
        expect(normalized).toBe(realpathSync.native(dir))
        expect(normalizeProjectPath(normalized)).toBe(normalized)
    })

    it('resolves a relative path to an absolute one', () => {
        expect(path.isAbsolute(normalizeProjectPath('.'))).toBe(true)
    })

    it('falls back to a resolved absolute path when the path does not exist, without throwing', () => {
        const missing: string = path.join(base, 'does-not-exist')

        expect(() => normalizeProjectPath(missing)).not.toThrow()
        expect(normalizeProjectPath(missing)).toBe(path.resolve(missing))
    })

    it('resolves a symlink to its target — one canonical path on every platform', () => {
        const target: string = path.join(base, 'target')
        const alias: string = path.join(base, 'alias')
        mkdirSync(target)
        symlinkSync(target, alias)

        expect(normalizeProjectPath(alias)).toBe(normalizeProjectPath(target))
    })

    it('collapses casing variants only when the filesystem is case-insensitive', () => {
        const dir: string = path.join(base, 'CaseProbe')
        mkdirSync(dir)
        const variant: string = path.join(base, 'caseprobe')

        let filesystemIsCaseInsensitive: boolean = false
        try {
            filesystemIsCaseInsensitive = realpathSync.native(variant) === realpathSync.native(dir)
        } catch {
            // The lower-cased variant does not exist → case-sensitive filesystem.
        }

        if (filesystemIsCaseInsensitive) {
            // APFS / NTFS: both casings name one directory, so they normalize equal.
            expect(normalizeProjectPath(variant)).toBe(normalizeProjectPath(dir))
        } else {
            // Case-sensitive filesystem: the variant is a different (absent) path,
            // so it must NOT be folded into `dir` — it resolves to itself.
            expect(normalizeProjectPath(variant)).toBe(path.resolve(variant))
        }
    })
})
