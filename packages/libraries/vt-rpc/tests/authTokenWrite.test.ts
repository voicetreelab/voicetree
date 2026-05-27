// Black-box tests for the daemon-side token generator + writer. The token
// file mode (0600) is the trust root for the LAN-exposed daemon (design doc
// §2.4); we assert the bits explicitly.

import {chmod, mkdir, mkdtemp, readFile, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

import {authTokenFilePath, readAuthTokenFile} from '../src/authTokenFile.ts'
import {generateAuthToken, writeAuthTokenFile} from '../src/authTokenWrite.ts'

async function makeVault(): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), 'vt-authtoken-write-'))
    await mkdir(join(dir, '.voicetree'), {recursive: true})
    return dir
}

describe('generateAuthToken', (): void => {
    it('produces a 64-char hex string (32 bytes)', (): void => {
        const tok: string = generateAuthToken()
        expect(tok).toMatch(/^[0-9a-f]{64}$/)
    })

    it('produces distinct tokens on every call (no cross-restart reuse)', (): void => {
        const a: string = generateAuthToken()
        const b: string = generateAuthToken()
        const c: string = generateAuthToken()
        expect(new Set([a, b, c]).size).toBe(3)
    })
})

describe('writeAuthTokenFile', (): void => {
    it('writes the token + trailing newline and round-trips via readAuthTokenFile', async (): Promise<void> => {
        const vault: string = await makeVault()
        const token: string = generateAuthToken()
        await writeAuthTokenFile(vault, token)
        const raw: string = await readFile(authTokenFilePath(vault), 'utf8')
        expect(raw).toBe(`${token}\n`)
        expect(await readAuthTokenFile(vault)).toBe(token)
    })

    it('file mode is 0600 (owner read/write only)', async (): Promise<void> => {
        const vault: string = await makeVault()
        const token: string = generateAuthToken()
        await writeAuthTokenFile(vault, token)
        const stats = await stat(authTokenFilePath(vault))
        // mode includes file-type bits; mask out and compare permission bits.
        // eslint-disable-next-line no-bitwise
        expect(stats.mode & 0o777).toBe(0o600)
    })

    it('overwrites any prior token atomically (atomic re-key on restart)', async (): Promise<void> => {
        const vault: string = await makeVault()
        const first: string = generateAuthToken()
        await writeAuthTokenFile(vault, first)
        // Loosen mode then rewrite — confirms the rewrite restores 0600.
        await chmod(authTokenFilePath(vault), 0o644)
        const second: string = generateAuthToken()
        await writeAuthTokenFile(vault, second)
        expect(await readAuthTokenFile(vault)).toBe(second)
        const stats = await stat(authTokenFilePath(vault))
        // eslint-disable-next-line no-bitwise
        expect(stats.mode & 0o777).toBe(0o600)
    })

    it('refuses to write an empty token', async (): Promise<void> => {
        const vault: string = await makeVault()
        await expect(writeAuthTokenFile(vault, '')).rejects.toThrow(/empty/)
    })
})
