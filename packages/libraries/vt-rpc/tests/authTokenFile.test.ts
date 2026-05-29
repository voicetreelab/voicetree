import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

import {
    authTokenFilePath,
    readAuthTokenFile,
    redactAuthorizationHeader,
    redactToken,
} from '../src/authTokenFile.ts'

async function makeProject(): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), 'vt-rpc-auth-'))
    await mkdir(join(dir, '.voicetree'), {recursive: true})
    return dir
}

describe('readAuthTokenFile', (): void => {
    it('returns the token verbatim, trimmed', async (): Promise<void> => {
        const project: string = await makeProject()
        await writeFile(authTokenFilePath(project), '  abcdef0123456789\n', 'utf8')
        expect(await readAuthTokenFile(project)).toBe('abcdef0123456789')
    })

    it('returns null when the file is missing', async (): Promise<void> => {
        const project: string = await makeProject()
        expect(await readAuthTokenFile(project)).toBe(null)
    })

    it('returns null for whitespace-only content', async (): Promise<void> => {
        const project: string = await makeProject()
        await writeFile(authTokenFilePath(project), '   \n\t  ', 'utf8')
        expect(await readAuthTokenFile(project)).toBe(null)
    })
})

describe('redaction', (): void => {
    it('keeps the last 4 chars so logs are correlatable', (): void => {
        expect(redactToken('abcdef0123456789')).toBe('****6789')
    })

    it('fully masks very short tokens', (): void => {
        expect(redactToken('xyz')).toBe('****')
        expect(redactToken('xyzw')).toBe('****')
    })

    it('redacts a Bearer Authorization header in place', (): void => {
        expect(redactAuthorizationHeader('Bearer abcdef0123456789')).toBe('Bearer ****6789')
    })

    it('leaves non-Bearer schemes alone', (): void => {
        expect(redactAuthorizationHeader('Basic dXNlcjpwYXNz')).toBe('Basic dXNlcjpwYXNz')
    })
})
