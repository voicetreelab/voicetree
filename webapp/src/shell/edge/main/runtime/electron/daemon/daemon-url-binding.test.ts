// Black-box: brings up the in-process HTTP daemon for a real tmp vault via
// `bindHttpDaemonForVault`, then asserts `getDaemonUrl` resolves through the
// in-process bound state — independent of where (or whether) `rpc.port`
// landed on disk.
//
// Regression guard for the writer/reader divergence that ENOENT'd the
// renderer when the bound vault had a `voicetree-{day}-{month}` write
// subdir: the writer keys off `projectRoot`, the renderer-facing reader
// used to key off `getVaultPaths()[0]` (which is `writeFolder`). Reading
// the in-process state removes the path dependence entirely.
//
// `getAuthToken` was removed from this module in BF-368; Main-side bridges
// (events, terminal-attach) now consume `getActiveAuthToken` from
// http-server-binding directly, and the renderer no longer reads the token.

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {promises as fs} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
    app: {
        getPath: vi.fn(() => path.join(os.tmpdir(), `daemon-url-binding-test-userdata-${Date.now()}`)),
    },
}))

import {bindHttpDaemonForVault, getActiveAuthToken, unbindHttpDaemon} from './http-server-binding'
import {getDaemonUrl} from './daemon-url-binding'

interface VaultLayout {
    readonly projectRoot: string
    readonly writeSubdir: string
}

async function makeProjectWithDatedWriteSubdir(): Promise<VaultLayout> {
    const projectRoot: string = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-url-binding-test-'))
    // Mirror the on-disk shape that exposes the bug in production: a
    // `voicetree-{day}-{month}` subdir under projectRoot. `bindHttpDaemonForVault`
    // is invoked with projectRoot; spawned-agent / renderer infra (pre-fix)
    // looked up `rpc.port` under the writeFolder, which is this subdir.
    const writeSubdir: string = path.join(projectRoot, 'voicetree-22-5')
    await fs.mkdir(writeSubdir, {recursive: true})
    return {projectRoot, writeSubdir}
}

const createdRoots: string[] = []

beforeEach(async (): Promise<void> => {
    delete process.env.VOICETREE_DAEMON_URL
})

afterEach(async (): Promise<void> => {
    await unbindHttpDaemon().catch((): void => {})
    delete process.env.VOICETREE_DAEMON_URL
    while (createdRoots.length > 0) {
        const root: string = createdRoots.pop()!
        await fs.rm(root, {recursive: true, force: true}).catch((): void => {})
    }
})

describe('getDaemonUrl', (): void => {
    it('returns the active daemon URL after bind, independent of where rpc.port lives on disk', async (): Promise<void> => {
        const {projectRoot, writeSubdir} = await makeProjectWithDatedWriteSubdir()
        createdRoots.push(projectRoot)

        const handle = await bindHttpDaemonForVault(projectRoot)
        const url: string = await getDaemonUrl()

        expect(url).toBe(handle.url)
        // The disk-file path is no longer the source of truth: rpc.port
        // landed at projectRoot/.voicetree/rpc.port (writer convention),
        // and `getDaemonUrl` resolves correctly without consulting either
        // projectRoot's or writeSubdir's `.voicetree/rpc.port`.
        const rpcPortAtProjectRoot: string = await fs.readFile(
            path.join(projectRoot, '.voicetree', 'rpc.port'),
            'utf-8',
        )
        expect(rpcPortAtProjectRoot.trim()).toBe(String(handle.port))
        // writeSubdir has no rpc.port — pre-fix the reader would have ENOENT'd here.
        await expect(
            fs.readFile(path.join(writeSubdir, '.voicetree', 'rpc.port'), 'utf-8'),
        ).rejects.toMatchObject({code: 'ENOENT'})
    })

    it('throws daemon_unreachable before any bind', async (): Promise<void> => {
        await expect(getDaemonUrl()).rejects.toThrow(/daemon_unreachable/)
    })

    it('throws daemon_unreachable after unbind', async (): Promise<void> => {
        const {projectRoot} = await makeProjectWithDatedWriteSubdir()
        createdRoots.push(projectRoot)

        await bindHttpDaemonForVault(projectRoot)
        await unbindHttpDaemon()

        await expect(getDaemonUrl()).rejects.toThrow(/daemon_unreachable/)
    })

    it('honors $VOICETREE_DAEMON_URL override even when no daemon is bound', async (): Promise<void> => {
        process.env.VOICETREE_DAEMON_URL = 'http://example.test:1234'
        const url: string = await getDaemonUrl()
        expect(url).toBe('http://example.test:1234')
    })
})

describe('getActiveAuthToken (Main-side consumers)', (): void => {
    it('returns the active token after bind, matches the on-disk file', async (): Promise<void> => {
        const {projectRoot} = await makeProjectWithDatedWriteSubdir()
        createdRoots.push(projectRoot)

        await bindHttpDaemonForVault(projectRoot)
        const token: string | null = getActiveAuthToken()

        expect(token).toMatch(/^[0-9a-f]{64}$/)
        // The file at projectRoot should match in-process token (out-of-process
        // consumers still read it from disk).
        const onDisk: string = await fs.readFile(
            path.join(projectRoot, '.voicetree', 'auth-token'),
            'utf-8',
        )
        expect(onDisk.trim()).toBe(token)
    })

    it('returns null before any bind', (): void => {
        expect(getActiveAuthToken()).toBeNull()
    })

    it('returns null after unbind', async (): Promise<void> => {
        const {projectRoot} = await makeProjectWithDatedWriteSubdir()
        createdRoots.push(projectRoot)

        await bindHttpDaemonForVault(projectRoot)
        await unbindHttpDaemon()

        expect(getActiveAuthToken()).toBeNull()
    })
})
