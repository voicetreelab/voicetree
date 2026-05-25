// Black-box tests for `callDaemon` against a real HTTP wire — design doc
// §4.1 / §4.2 contract. No mocks; tests boot either the production daemon
// (`startHttpDaemonServer`) for behavior on the happy paths or a minimal
// `http.createServer` instance when we need wire-level control (401 retry
// flips, hang-for-timeout, ECONNREFUSED).
//
// Discovery uses real env vars and `process.chdir`, matching the harness
// pattern in `graphCreateHarness.ts`. Per CLAUDE.md: real `http.createServer`,
// real `fetch`, no `toHaveBeenCalledWith`, observable side effects only.

import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
    buildJsonResponse,
    CatalogValidationError,
    startHttpDaemonServer,
    type HookHandler,
    type HttpDaemonServerHandle,
    type ToolCatalog,
} from '@vt/vt-daemon'
import {authTokenFilePath, generateAuthToken, writeAuthTokenFile, writeRpcPortFile} from '@vt/vt-rpc'

import {callDaemon, DaemonTimeout, DaemonUnreachable} from './daemon-client.ts'

const noopHookHandler: HookHandler = (): unknown => ({ok: true})

interface ProductionDaemonHandle {
    readonly vaultPath: string
    readonly url: string
    readonly token: string
    readonly handle: HttpDaemonServerHandle
}

async function makeVault(prefix: string): Promise<string> {
    const dir: string = await realpath(await mkdtemp(join(tmpdir(), prefix)))
    await mkdir(join(dir, '.voicetree'), {recursive: true})
    return dir
}

async function startProductionDaemon(
    toolName: string,
    handler: (args: Record<string, unknown>) => Promise<{type: 'ok'; payload: unknown} | {type: 'error'; payload: unknown} | {type: 'throw'; err: unknown}>,
): Promise<ProductionDaemonHandle> {
    const vaultPath: string = await makeVault('vt-daemon-client-')
    const token: string = generateAuthToken()
    await writeAuthTokenFile(vaultPath, token)
    const catalog: ToolCatalog = new Map([
        [toolName, async (args: Record<string, unknown>) => {
            const outcome = await handler(args)
            if (outcome.type === 'throw') throw outcome.err
            return buildJsonResponse(outcome.payload, outcome.type === 'error')
        }],
    ])
    const handle: HttpDaemonServerHandle = await startHttpDaemonServer({
        catalog,
        hookHandler: noopHookHandler,
        token,
        bindHost: '127.0.0.1',
        logger: {logRequest: (): void => {}, logError: (): void => {}},
    })
    await writeRpcPortFile(vaultPath, handle.port)
    return {vaultPath, url: handle.url, token, handle}
}

interface RawHttpServer {
    readonly port: number
    readonly url: string
    readonly close: () => Promise<void>
}

async function startRawServer(
    requestListener: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<RawHttpServer> {
    const server: Server = createServer(requestListener)
    await new Promise<void>((resolveListen): void => {
        server.listen(0, '127.0.0.1', (): void => resolveListen())
    })
    const address = server.address()
    if (typeof address !== 'object' || address === null) throw new Error('listen returned no address')
    const port: number = address.port
    return {
        port,
        url: `http://127.0.0.1:${port}`,
        close: (): Promise<void> => new Promise<void>((resolveClose, rejectClose): void => {
            server.closeAllConnections?.()
            server.close((err): void => (err ? rejectClose(err) : resolveClose()))
        }),
    }
}

interface EnvState {
    readonly snapshot: Record<string, string | undefined>
    readonly cwdSnapshot: string
}

function snapshotEnv(): EnvState {
    const KEYS: ReadonlyArray<string> = [
        'VOICETREE_DAEMON_URL',
        'VOICETREE_VAULT_PATH',
        'VOICETREE_DAEMON_TIMEOUT_MS',
    ]
    const snapshot: Record<string, string | undefined> = {}
    for (const k of KEYS) snapshot[k] = process.env[k]
    return {snapshot, cwdSnapshot: process.cwd()}
}

function restoreEnv(state: EnvState): void {
    for (const [k, v] of Object.entries(state.snapshot)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
    }
    process.chdir(state.cwdSnapshot)
}

function clearDiscoveryEnv(): void {
    delete process.env.VOICETREE_DAEMON_URL
    delete process.env.VOICETREE_VAULT_PATH
    delete process.env.VOICETREE_DAEMON_TIMEOUT_MS
}

describe('callDaemon — black-box HTTP wire', () => {
    let envState: EnvState
    const cleanups: Array<() => Promise<void>> = []
    const tempDirs: string[] = []

    beforeEach(() => {
        envState = snapshotEnv()
        clearDiscoveryEnv()
    })

    afterEach(async () => {
        await Promise.all(cleanups.splice(0).map((fn) => fn().catch(() => undefined)))
        for (const d of tempDirs.splice(0)) await rm(d, {recursive: true, force: true})
        restoreEnv(envState)
    })

    it('happy path: returns parsed tool payload', async () => {
        const expectedPayload = {nodes: [{path: 'a.md'}], cursor: 'abc'}
        const daemon = await startProductionDaemon('search_nodes', async () => ({type: 'ok', payload: expectedPayload}))
        cleanups.push(daemon.handle.stop)
        tempDirs.push(daemon.vaultPath)
        process.chdir(daemon.vaultPath)

        const result: unknown = await callDaemon('search_nodes', {query: 'a'})
        expect(result).toEqual(expectedPayload)
    })

    it('-32003 tool_handler_failed envelope: throws Error whose message is JSON.stringify(error.data)', async () => {
        const failurePayload = {kind: 'tool_failure_envelope', detail: 'cannot apply'}
        const daemon = await startProductionDaemon('create_graph', async () => ({type: 'error', payload: failurePayload}))
        cleanups.push(daemon.handle.stop)
        tempDirs.push(daemon.vaultPath)
        process.chdir(daemon.vaultPath)

        await expect(callDaemon('create_graph', {batch: []})).rejects.toMatchObject({
            message: JSON.stringify(failurePayload),
        })
    })

    it('-32602 validation_failed envelope: throws Error with kind: validation_failed and the data wrapped', async () => {
        const issues: ReadonlyArray<unknown> = [{path: ['query'], message: 'Required'}]
        const daemon = await startProductionDaemon('search_nodes', async () => ({
            type: 'throw',
            err: new CatalogValidationError('search_nodes', issues),
        }))
        cleanups.push(daemon.handle.stop)
        tempDirs.push(daemon.vaultPath)
        process.chdir(daemon.vaultPath)

        const expectedData = {kind: 'validation_failed', tool: 'search_nodes', issues}
        await expect(callDaemon('search_nodes', {})).rejects.toMatchObject({
            message: JSON.stringify({kind: 'validation_failed', data: expectedData}),
        })
    })

    it('first-call 401 with stale token-on-disk: retry-after-disk-refresh succeeds', async () => {
        const vault: string = await makeVault('vt-401-fresh-')
        tempDirs.push(vault)
        const staleToken: string = generateAuthToken()
        const currentToken: string = generateAuthToken()
        await writeAuthTokenFile(vault, staleToken)

        const tokenFile: string = authTokenFilePath(vault)
        const raw = await startRawServer((req, res) => {
            void readBody(req).then(async () => {
                const auth: string | undefined = req.headers.authorization
                if (auth !== `Bearer ${currentToken}`) {
                    // Simulate daemon-side token-rotation: write the current token
                    // to disk just before rejecting, so the CLI's re-read picks it up.
                    await writeFile(tokenFile, `${currentToken}\n`, 'utf8')
                    res.statusCode = 401
                    res.end()
                    return
                }
                res.statusCode = 200
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({jsonrpc: '2.0', id: 1, result: {ok: true, after: 'retry'}}))
            })
        })
        cleanups.push(raw.close)
        await writeRpcPortFile(vault, raw.port)
        process.chdir(vault)

        const result: unknown = await callDaemon('search_nodes', {q: 'x'})
        expect(result).toEqual({ok: true, after: 'retry'})
    })

    it('first-call 401 with disk token still bad: retries once then throws DaemonAuthRequired naming the token file', async () => {
        const vault: string = await makeVault('vt-401-exhaust-')
        tempDirs.push(vault)
        const wrongToken: string = generateAuthToken()
        await writeAuthTokenFile(vault, wrongToken)

        let authRequiredCount: number = 0
        const raw = await startRawServer((req, res) => {
            void readBody(req).then(() => {
                authRequiredCount += 1
                res.statusCode = 401
                res.end()
            })
        })
        cleanups.push(raw.close)
        await writeRpcPortFile(vault, raw.port)
        process.chdir(vault)

        const tokenFile: string = authTokenFilePath(vault)
        await expect(callDaemon('search_nodes', {})).rejects.toMatchObject({
            name: 'DaemonAuthRequired',
            message: expect.stringContaining(tokenFile),
        })
        expect(authRequiredCount).toBe(2)
    })

    it('timeout exceeded: throws DaemonTimeout; underlying fetch was aborted (no response received)', async () => {
        const vault: string = await makeVault('vt-timeout-')
        tempDirs.push(vault)
        const token: string = generateAuthToken()
        await writeAuthTokenFile(vault, token)

        let observedAbort: boolean = false
        const raw = await startRawServer((req, _res) => {
            req.on('aborted', () => {
                observedAbort = true
            })
            req.on('close', () => {
                if (req.destroyed) observedAbort = true
            })
            // Intentionally never call res.end(): hold the request open until the client aborts.
        })
        cleanups.push(raw.close)
        await writeRpcPortFile(vault, raw.port)
        process.chdir(vault)
        process.env.VOICETREE_DAEMON_TIMEOUT_MS = '120'

        const err: unknown = await callDaemon('search_nodes', {}).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(DaemonTimeout)
        expect((err as Error).message).toContain('did not respond')
        // Allow the server to observe the abort before we tear it down.
        await new Promise((r) => setTimeout(r, 20))
        expect(observedAbort).toBe(true)
    })

    it('ECONNREFUSED (daemon not running at the port): throws DaemonUnreachable', async () => {
        const vault: string = await makeVault('vt-econnrefused-')
        tempDirs.push(vault)
        await writeAuthTokenFile(vault, generateAuthToken())

        const placeholder = await startRawServer(() => {})
        const deadPort: number = placeholder.port
        await placeholder.close()
        await writeRpcPortFile(vault, deadPort)
        process.chdir(vault)

        const err: unknown = await callDaemon('search_nodes', {}).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(DaemonUnreachable)
    })

    describe('discovery chain ordering (3 tiers + fail-fast)', () => {
        it('env URL wins when both env URL and cwd up-walk are valid', async () => {
            const winning = await startProductionDaemon('search_nodes', async () => ({
                type: 'ok',
                payload: {via: 'env_url'},
            }))
            cleanups.push(winning.handle.stop)
            tempDirs.push(winning.vaultPath)

            const losing = await startProductionDaemon('search_nodes', async () => ({
                type: 'ok',
                payload: {via: 'cwd_up_walk'},
            }))
            cleanups.push(losing.handle.stop)
            tempDirs.push(losing.vaultPath)

            process.chdir(losing.vaultPath)
            process.env.VOICETREE_DAEMON_URL = winning.url
            process.env.VOICETREE_VAULT_PATH = winning.vaultPath

            const result: unknown = await callDaemon('search_nodes', {})
            expect(result).toEqual({via: 'env_url'})
        })

        it('cwd up-walk wins when env URL is unset (only port file present)', async () => {
            const daemon = await startProductionDaemon('search_nodes', async () => ({
                type: 'ok',
                payload: {via: 'cwd_up_walk'},
            }))
            cleanups.push(daemon.handle.stop)
            tempDirs.push(daemon.vaultPath)
            process.chdir(daemon.vaultPath)

            const result: unknown = await callDaemon('search_nodes', {})
            expect(result).toEqual({via: 'cwd_up_walk'})
        })

        it('neither env URL nor port file: throws DaemonUnreachable naming the missing vars', async () => {
            const empty = await mkdtemp(join(tmpdir(), 'vt-empty-cwd-'))
            tempDirs.push(empty)
            process.chdir(empty)

            const err: unknown = await callDaemon('search_nodes', {}).catch((e: unknown) => e)
            expect(err).toBeInstanceOf(DaemonUnreachable)
            const msg: string = (err as Error).message
            expect(msg).toContain('VOICETREE_DAEMON_URL')
            expect(msg).toContain('VOICETREE_VAULT_PATH')
        })
    })
})

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise<string>((resolveBody, rejectBody): void => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer): void => {
            chunks.push(c)
        })
        req.on('end', (): void => resolveBody(Buffer.concat(chunks).toString('utf8')))
        req.on('error', rejectBody)
    })
}
