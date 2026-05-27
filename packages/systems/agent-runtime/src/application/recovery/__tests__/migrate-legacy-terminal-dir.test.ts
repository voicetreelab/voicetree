import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {migrateLegacyTerminalDir} from '../persistence/migrate-legacy-terminal-dir'
import {getRecoveryMetadataDir} from '../paths'

function makeFixtureRoot(): string {
    return join(tmpdir(), `vt-migrate-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

describe('migrateLegacyTerminalDir', () => {
    let projectRoot: string
    let writeFolder: string

    beforeEach(() => {
        const base: string = makeFixtureRoot()
        projectRoot = join(base, 'project')
        writeFolder = join(base, 'project', 'inner-vault')
        mkdirSync(projectRoot, {recursive: true})
        mkdirSync(writeFolder, {recursive: true})
    })

    afterEach(() => {
        try { rmSync(join(projectRoot, '..'), {recursive: true, force: true}) } catch { /* ignore */ }
    })

    function seedLegacy(filename: string, contents: string): void {
        const legacyDir: string = getRecoveryMetadataDir(writeFolder)
        mkdirSync(legacyDir, {recursive: true})
        writeFileSync(join(legacyDir, filename), contents)
    }

    function readCanonical(filename: string): string {
        return readFileSync(join(getRecoveryMetadataDir(projectRoot), filename), 'utf8')
    }

    it('is a no-op when writeFolder equals projectRoot', () => {
        seedLegacy('A.json', '{"name":"A"}')
        const result = migrateLegacyTerminalDir({projectRoot: writeFolder, writeFolder})
        expect(result).toEqual({moved: [], conflicts: [], skipped: []})
        expect(existsSync(join(getRecoveryMetadataDir(writeFolder), 'A.json'))).toBe(true)
    })

    it('is a no-op when legacy directory does not exist', () => {
        const result = migrateLegacyTerminalDir({projectRoot, writeFolder})
        expect(result).toEqual({moved: [], conflicts: [], skipped: []})
    })

    it('moves a JSON record from legacy to canonical', () => {
        seedLegacy('A.json', '{"name":"A","status":"exited"}')
        const result = migrateLegacyTerminalDir({projectRoot, writeFolder})
        expect(result.moved).toEqual(['A.json'])
        expect(readCanonical('A.json')).toBe('{"name":"A","status":"exited"}')
        expect(existsSync(join(getRecoveryMetadataDir(writeFolder), 'A.json'))).toBe(false)
    })

    it('moves sibling .log / -prompt.txt / .exitcode when present', () => {
        seedLegacy('A.json', '{}')
        seedLegacy('A.log', 'log-contents')
        seedLegacy('A-prompt.txt', 'prompt-contents')
        seedLegacy('A.exitcode', '0')
        migrateLegacyTerminalDir({projectRoot, writeFolder})
        expect(readCanonical('A.log')).toBe('log-contents')
        expect(readCanonical('A-prompt.txt')).toBe('prompt-contents')
        expect(readCanonical('A.exitcode')).toBe('0')
    })

    it('does not fail when expected siblings are absent', () => {
        seedLegacy('B.json', '{}')
        const result = migrateLegacyTerminalDir({projectRoot, writeFolder})
        expect(result.moved).toEqual(['B.json'])
        expect(readCanonical('B.json')).toBe('{}')
    })

    it('keeps canonical copy on conflict and leaves legacy untouched', () => {
        seedLegacy('C.json', '{"from":"legacy"}')
        mkdirSync(getRecoveryMetadataDir(projectRoot), {recursive: true})
        writeFileSync(join(getRecoveryMetadataDir(projectRoot), 'C.json'), '{"from":"canonical"}')

        const warnings: string[] = []
        const result = migrateLegacyTerminalDir({projectRoot, writeFolder, logger: {warn: (m) => warnings.push(m)}})

        expect(result.conflicts).toEqual(['C.json'])
        expect(result.moved).toEqual([])
        expect(readCanonical('C.json')).toBe('{"from":"canonical"}')
        expect(readFileSync(join(getRecoveryMetadataDir(writeFolder), 'C.json'), 'utf8')).toBe('{"from":"legacy"}')
        expect(warnings.some((w) => w.includes('C.json'))).toBe(true)
    })

    it('is idempotent across repeated runs', () => {
        seedLegacy('D.json', '{}')
        const first = migrateLegacyTerminalDir({projectRoot, writeFolder})
        const second = migrateLegacyTerminalDir({projectRoot, writeFolder})
        expect(first.moved).toEqual(['D.json'])
        expect(second.moved).toEqual([])
        expect(second.conflicts).toEqual([])
        expect(readCanonical('D.json')).toBe('{}')
    })

    it('migrates malformed JSON without attempting to parse', () => {
        const garbage: string = '{this is not parseable'
        seedLegacy('E.json', garbage)
        migrateLegacyTerminalDir({projectRoot, writeFolder})
        expect(readCanonical('E.json')).toBe(garbage)
    })

    it('writes MIGRATED.txt stub in the legacy dir on first successful move', () => {
        seedLegacy('F.json', '{}')
        migrateLegacyTerminalDir({projectRoot, writeFolder})
        const stubPath: string = join(getRecoveryMetadataDir(writeFolder), 'MIGRATED.txt')
        expect(existsSync(stubPath)).toBe(true)
        expect(readFileSync(stubPath, 'utf8')).toContain(getRecoveryMetadataDir(projectRoot))
    })

    it('skips MIGRATED.txt when no records were moved', () => {
        mkdirSync(getRecoveryMetadataDir(writeFolder), {recursive: true})
        const result = migrateLegacyTerminalDir({projectRoot, writeFolder})
        expect(result.moved).toEqual([])
        expect(existsSync(join(getRecoveryMetadataDir(writeFolder), 'MIGRATED.txt'))).toBe(false)
    })

    it('ignores non-JSON entries in the legacy directory', () => {
        seedLegacy('G.json', '{}')
        seedLegacy('README.md', 'unrelated')
        const result = migrateLegacyTerminalDir({projectRoot, writeFolder})
        expect(result.moved).toEqual(['G.json'])
        const legacyContents: string[] = readdirSync(getRecoveryMetadataDir(writeFolder))
        expect(legacyContents).toContain('README.md')
    })
})
