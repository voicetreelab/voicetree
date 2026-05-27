import {mkdtempSync, mkdirSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {detectVaultFromCwd, resolveVault, VaultNotDetectedError} from './detectVault'

const tmpDirs: string[] = []

function makeTmpDir(): string {
    const dir: string = mkdtempSync(join(tmpdir(), 'detect-vault-'))
    tmpDirs.push(dir)
    return dir
}

function makeVault(rootPath: string): string {
    mkdirSync(join(rootPath, '.voicetree'), {recursive: true})
    return rootPath
}

afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
        rmSync(dir, {recursive: true, force: true})
    }
})

describe('detectVaultFromCwd', () => {
    it('returns the nearest ancestor vault when cwd is nested inside it', () => {
        const tmpDir: string = makeTmpDir()
        const vaultRoot: string = makeVault(join(tmpDir, 'workspace'))
        const nestedDir: string = join(vaultRoot, 'notes', 'deep')
        mkdirSync(nestedDir, {recursive: true})

        expect(detectVaultFromCwd(nestedDir)).toBe(vaultRoot)
    })

    it('returns the cwd when it is already the vault root', () => {
        const tmpDir: string = makeTmpDir()
        const vaultRoot: string = makeVault(join(tmpDir, 'workspace'))

        expect(detectVaultFromCwd(vaultRoot)).toBe(vaultRoot)
    })

    it('returns null when no ancestor contains a .voicetree marker', () => {
        const tmpDir: string = makeTmpDir()
        const nestedDir: string = join(tmpDir, 'plain', 'folder')
        mkdirSync(nestedDir, {recursive: true})

        expect(detectVaultFromCwd(nestedDir)).toBeNull()
    })

    it('prefers the innermost vault when vaults are nested', () => {
        const tmpDir: string = makeTmpDir()
        const outerVault: string = makeVault(join(tmpDir, 'outer'))
        const innerVault: string = makeVault(join(outerVault, 'projects', 'inner'))
        const nestedDir: string = join(innerVault, 'drafts')
        mkdirSync(nestedDir, {recursive: true})

        expect(detectVaultFromCwd(nestedDir)).toBe(innerVault)
    })
})

describe('resolveVault', () => {
    it('returns the explicit --vault override when it points at a valid vault', () => {
        const tmpDir: string = makeTmpDir()
        const vaultRoot: string = makeVault(join(tmpDir, 'workspace'))

        expect(resolveVault({flag: vaultRoot, cwd: tmpDir})).toBe(vaultRoot)
    })

    it('resolves relative --vault overrides from cwd before validating them', () => {
        const tmpDir: string = makeTmpDir()
        const vaultRoot: string = makeVault(join(tmpDir, 'workspace'))

        expect(resolveVault({flag: './workspace', cwd: tmpDir})).toBe(vaultRoot)
    })

    it('falls back to cwd detection when no --vault override is provided', () => {
        const tmpDir: string = makeTmpDir()
        const vaultRoot: string = makeVault(join(tmpDir, 'workspace'))
        const nestedDir: string = join(vaultRoot, 'notes')
        mkdirSync(nestedDir, {recursive: true})

        expect(resolveVault({cwd: nestedDir})).toBe(vaultRoot)
    })

    it('throws a typed error when --vault does not point at a valid vault root', () => {
        const tmpDir: string = makeTmpDir()
        const invalidPath: string = join(tmpDir, 'not-a-vault')
        mkdirSync(invalidPath, {recursive: true})
        const call = (): string => resolveVault({flag: invalidPath, cwd: tmpDir})

        expect(call).toThrowError(VaultNotDetectedError)
        expect(call).toThrow('.voicetree/')
    })

    it('throws a typed error with guidance when neither flag nor cwd resolves a vault', () => {
        const tmpDir: string = makeTmpDir()
        const nestedDir: string = join(tmpDir, 'plain', 'folder')
        mkdirSync(nestedDir, {recursive: true})
        const call = (): string => resolveVault({cwd: nestedDir})

        expect(call).toThrowError(VaultNotDetectedError)
        expect(call).toThrow('No vault found. Run inside a vault directory, or pass --vault <path>.')
    })
})
