// Black-box test for readAuthToken: write a real auth-token file (exactly as vtd
// does — trailing newline, mode 0600), assert the trimmed token comes back, and
// assert a missing file throws. Hits the real filesystem; no mocks.

import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {readAuthToken} from './serveHarness.ts'

describe('readAuthToken', () => {
    let project: string

    beforeEach(async () => {
        project = await mkdtemp(join(tmpdir(), 'vt-authtoken-'))
        await mkdir(join(project, '.voicetree'), {recursive: true})
    })

    afterEach(async () => {
        await rm(project, {recursive: true, force: true}).catch(() => undefined)
    })

    it('returns the token, trimming the trailing newline vtd writes', async () => {
        await writeFile(join(project, '.voicetree', 'auth-token'), 'a1b2c3d4e5f6\n', 'utf8')
        await expect(readAuthToken(project)).resolves.toBe('a1b2c3d4e5f6')
    })

    it('throws when the auth-token file is absent', async () => {
        await expect(readAuthToken(project)).rejects.toThrow(/auth-token missing or empty/)
    })

    it('throws when the auth-token file is empty/whitespace-only', async () => {
        await writeFile(join(project, '.voicetree', 'auth-token'), '   \n', 'utf8')
        await expect(readAuthToken(project)).rejects.toThrow(/auth-token missing or empty/)
    })
})
