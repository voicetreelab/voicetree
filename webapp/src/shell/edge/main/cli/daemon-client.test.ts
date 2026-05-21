import {existsSync} from 'node:fs'
import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises'
import net from 'node:net'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
    buildJsonResponse,
    startUdsServer,
    type ToolCatalog,
    type UdsServerHandle,
} from '@vt/voicetree-mcp'
import {callDaemon} from './daemon-client'

type EnvSnapshot = {
    sock: string | undefined
    vault: string | undefined
}

function snapshotEnv(): EnvSnapshot {
    return {
        sock: process.env.VOICETREE_SOCK_PATH,
        vault: process.env.VOICETREE_VAULT_PATH,
    }
}

function restoreEnv(snapshot: EnvSnapshot): void {
    if (snapshot.sock === undefined) delete process.env.VOICETREE_SOCK_PATH
    else process.env.VOICETREE_SOCK_PATH = snapshot.sock
    if (snapshot.vault === undefined) delete process.env.VOICETREE_VAULT_PATH
    else process.env.VOICETREE_VAULT_PATH = snapshot.vault
}

describe('daemon-client ↔ udsServer round-trip', () => {
    let workDir: string
    let socketPath: string
    let handle: UdsServerHandle | null
    let env: EnvSnapshot

    beforeEach(async () => {
        env = snapshotEnv()
        // realpath: macOS tmpdir is a /var → /private/var symlink. detectVault
        // calls process.cwd() which returns the realpath, but mkdtemp returns
        // the symlinked path. Equalize so the socket bind path and the up-walk
        // resolution agree.
        workDir = await realpath(await mkdtemp(join(tmpdir(), 'vt-daemon-client-')))
        socketPath = join(workDir, 'vt.sock')
        handle = null
    })

    afterEach(async () => {
        if (handle) await handle.stop()
        await rm(workDir, {recursive: true, force: true})
        restoreEnv(env)
    })

    it('returns the tool payload on success', async () => {
        const catalog: ToolCatalog = new Map([
            ['spawn_agent', async (args) => buildJsonResponse({success: true, terminalId: 'T1', echoed: args})],
        ])
        handle = await startUdsServer({socketPath, catalog, logger: {log: () => {}, error: () => {}}})
        process.env.VOICETREE_SOCK_PATH = socketPath

        const result: unknown = await callDaemon('spawn_agent', {callerTerminalId: 'caller', nodeId: '/n.md'})

        expect(result).toEqual({
            success: true,
            terminalId: 'T1',
            echoed: {callerTerminalId: 'caller', nodeId: '/n.md'},
        })
    })

    it('throws Error with JSON-stringified data when the tool returns isError=true', async () => {
        const catalog: ToolCatalog = new Map([
            ['spawn_agent', async () => buildJsonResponse({success: false, error: 'oops'}, true)],
        ])
        handle = await startUdsServer({socketPath, catalog, logger: {log: () => {}, error: () => {}}})
        process.env.VOICETREE_SOCK_PATH = socketPath

        await expect(callDaemon('spawn_agent', {}))
            .rejects.toThrow(/"success":false.*"error":"oops"/)
    })

    it('throws DaemonUnreachable when the socket path env var points nowhere', async () => {
        process.env.VOICETREE_SOCK_PATH = join(workDir, 'missing.sock')

        await expect(callDaemon('list_agents', {}))
            .rejects.toMatchObject({name: 'DaemonUnreachable'})
    })

    it('throws DaemonUnreachable when ECONNREFUSED on a stale socket file', async () => {
        await writeFile(socketPath, '', 'utf8') // stale file with no listener
        process.env.VOICETREE_SOCK_PATH = socketPath

        await expect(callDaemon('list_agents', {}))
            .rejects.toMatchObject({name: 'DaemonUnreachable'})
    })

    it('returns tool_not_found error when method is not in catalog', async () => {
        handle = await startUdsServer({
            socketPath,
            catalog: new Map(),
            logger: {log: () => {}, error: () => {}},
        })
        process.env.VOICETREE_SOCK_PATH = socketPath

        await expect(callDaemon('does_not_exist', {}))
            .rejects.toThrow(/Unknown method: does_not_exist/)
    })

    it('resolves the socket via vault up-walk when env var is unset', async () => {
        const vaultRoot: string = join(workDir, 'my-vault')
        await mkdir(join(vaultRoot, '.voicetree'), {recursive: true})
        const vaultSock: string = join(vaultRoot, '.voicetree', 'vt.sock')
        handle = await startUdsServer({
            socketPath: vaultSock,
            catalog: new Map([['list_agents', async () => buildJsonResponse({agents: []})]]),
            logger: {log: () => {}, error: () => {}},
        })
        delete process.env.VOICETREE_SOCK_PATH

        const subDir: string = join(vaultRoot, 'a', 'b', 'c')
        await mkdir(subDir, {recursive: true})
        const previousCwd: string = process.cwd()
        process.chdir(subDir)
        try {
            const result: unknown = await callDaemon('list_agents', {})
            expect(result).toEqual({agents: []})
        } finally {
            process.chdir(previousCwd)
        }
    })
})

describe('udsServer stale-socket cleanup', () => {
    let workDir: string
    let socketPath: string
    let handle: UdsServerHandle | null

    beforeEach(async () => {
        workDir = await realpath(await mkdtemp(join(tmpdir(), 'vt-uds-stale-')))
        socketPath = join(workDir, 'vt.sock')
        handle = null
    })

    afterEach(async () => {
        if (handle) await handle.stop()
        await rm(workDir, {recursive: true, force: true})
    })

    it('unlinks a stale socket file and binds successfully', async () => {
        await writeFile(socketPath, '', 'utf8')
        expect(existsSync(socketPath)).toBe(true)

        handle = await startUdsServer({
            socketPath,
            catalog: new Map([['list_agents', async () => buildJsonResponse({agents: []})]]),
            logger: {log: () => {}, error: () => {}},
        })

        // Sanity: we should be able to actually connect to the freshly-bound socket.
        await new Promise<void>((resolveConnect, rejectConnect): void => {
            const socket: net.Socket = net.createConnection({path: socketPath})
            socket.once('connect', (): void => {
                socket.end()
                resolveConnect()
            })
            socket.once('error', rejectConnect)
        })
    })

    it('aborts when another listener owns the socket', async () => {
        handle = await startUdsServer({
            socketPath,
            catalog: new Map(),
            logger: {log: () => {}, error: () => {}},
        })

        await expect(startUdsServer({
            socketPath,
            catalog: new Map(),
            logger: {log: () => {}, error: () => {}},
        })).rejects.toThrow(/already listening/)
    })
})
