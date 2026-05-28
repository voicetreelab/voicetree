// Black-box tests for `callDaemon` against a real HTTP wire — design doc
// §4.1 / §4.2 contract. No mocks; tests run hand-rolled `node:http` servers
// that respond with the wire envelopes the CLI client must handle.
//
// `callDaemon`'s contract surface is purely the wire shape: POST /rpc with
// `Authorization: Bearer <token>` + a JSON-RPC 2.0 envelope, response either
// `{result}` for success or `{error: {code, message, data}}` for failure.
// Stubbing the server in-test (rather than booting the real vt-daemon)
// keeps the CLI package decoupled from the daemon's internals — any drift in
// the wire contract surfaces as a `callDaemon` failure exactly as it would
// against the real daemon.
//
// Discovery uses real env vars and `process.chdir`. Per CLAUDE.md: real
// `http.createServer`, real `fetch`, no `toHaveBeenCalledWith`, observable
// side effects only.

import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import {mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
    ERROR_CODES,
    authTokenFilePath,
    generateAuthToken,
    writeAuthTokenFile,
    writeRpcPortFile,
} from '@vt/vt-rpc'

import {callDaemon, DaemonTimeout, DaemonUnreachable} from './daemon-client.ts'

interface JsonRpcRequestEnvelope {
    readonly jsonrpc: '2.0'
    readonly method: string
    readonly params: Record<string, unknown>
    readonly id: number | string | null
}

type ResponderOutcome =
    | {readonly type: 'ok'; readonly payload: unknown}
    | {readonly type: 'error'; readonly code: number; readonly message: string; readonly data: unknown}

interface StubDaemonHandle {
    readonly vaultPath: string
    readonly url: string
    readonly token: string
    readonly stop: () => Promise<void>
}

async function makeVault(prefix: string): Promise<string> {
    const dir: string = await realpath(await mkdtemp(join(tmpdir(), prefix)))
    await mkdir(join(dir, '.voicetree'), {recursive: true})
    return dir
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise<string>((resolveBody, rejectBody): void => {
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer): void => {
            chunks.push(chunk)
        })
        req.on('end', (): void => resolveBody(Buffer.concat(chunks).toString('utf8')))
        req.on('error', rejectBody)
    })
}

async function startStubDaemon(
    toolName: string,
    handler: (args: Record<string, unknown>) => Promise<ResponderOutcome>,
): Promise<StubDaemonHandle> {
    const vaultPath: string = await makeVault('vt-daemon-client-')
    const token: string = generateAuthToken()
    await writeAuthTokenFile(vaultPath, token)
    const raw: RawHttpServer = await startRawServer((req, res) => {
        void readBody(req).then(async (rawBody: string): Promise<void> => {
            const auth: string | undefined = req.headers.authorization
            if (auth !== `Bearer ${token}`) {
                res.statusCode = 401
                res.end()
                return
            }
            let envelope: JsonRpcRequestEnvelope
            try {
                envelope = JSON.parse(rawBody) as JsonRpcRequestEnvelope
            } catch {
                res.statusCode = 400
                res.end()
                return
            }
            if (envelope.method !== toolName) {
                res.statusCode = 404
                res.end()
                return
            }
            const outcome: ResponderOutcome = await handler(envelope.params ?? {})
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            const body: unknown = outcome.type === 'ok'
                ? {jsonrpc: '2.0', id: envelope.id, result: outcome.payload}
                : {jsonrpc: '2.0', id: envelope.id, error: {
                    code: outcome.code,
                    message: outcome.message,
                    data: outcome.data,
                }}
            res.end(JSON.stringify(body))
        })
    })
    await writeRpcPortFile(vaultPath, raw.port)
    return {vaultPath, url: raw.url, token, stop: raw.close}
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
        const daemon = await startStubDaemon('search_nodes', async () => ({type: 'ok', payload: expectedPayload}))
        cleanups.push(daemon.stop)
        tempDirs.push(daemon.vaultPath)
        process.chdir(daemon.vaultPath)

        const result: unknown = await callDaemon('search_nodes', {query: 'a'})
        expect(result).toEqual(expectedPayload)
    })

    it('-32003 tool_handler_failed envelope: throws Error whose message is JSON.stringify(error.data)', async () => {
        const failurePayload = {kind: 'tool_failure_envelope', detail: 'cannot apply'}
        const daemon = await startStubDaemon('create_graph', async () => ({
            type: 'error',
            code: ERROR_CODES.tool_handler_failed,
            message: 'tool handler failed',
            data: failurePayload,
        }))
        cleanups.push(daemon.stop)
        tempDirs.push(daemon.vaultPath)
        process.chdir(daemon.vaultPath)

        await expect(callDaemon('create_graph', {batch: []})).rejects.toMatchObject({
            message: JSON.stringify(failurePayload),
        })
    })

    it('-32602 validation_failed envelope: throws Error with kind: validation_failed and the data wrapped', async () => {
        const issues: ReadonlyArray<unknown> = [{path: ['query'], message: 'Required'}]
        // The real daemon emits this envelope when a tool's argument zod
        // schema fails — `data` is `{kind: 'validation_failed', tool, issues}`
        // (see rpcDispatch.ts in the vt-daemon package).
        const expectedData = {kind: 'validation_failed', tool: 'search_nodes', issues}
        const daemon = await startStubDaemon('search_nodes', async () => ({
            type: 'error',
            code: ERROR_CODES.validation_failed,
            message: 'validation_failed: search_nodes',
            data: expectedData,
        }))
        cleanups.push(daemon.stop)
        tempDirs.push(daemon.vaultPath)
        process.chdir(daemon.vaultPath)

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
            const winning = await startStubDaemon('search_nodes', async () => ({
                type: 'ok',
                payload: {via: 'env_url'},
            }))
            cleanups.push(winning.stop)
            tempDirs.push(winning.vaultPath)

            const losing = await startStubDaemon('search_nodes', async () => ({
                type: 'ok',
                payload: {via: 'cwd_up_walk'},
            }))
            cleanups.push(losing.stop)
            tempDirs.push(losing.vaultPath)

            process.chdir(losing.vaultPath)
            process.env.VOICETREE_DAEMON_URL = winning.url
            process.env.VOICETREE_VAULT_PATH = winning.vaultPath

            const result: unknown = await callDaemon('search_nodes', {})
            expect(result).toEqual({via: 'env_url'})
        })

        it('cwd up-walk wins when env URL is unset (only port file present)', async () => {
            const daemon = await startStubDaemon('search_nodes', async () => ({
                type: 'ok',
                payload: {via: 'cwd_up_walk'},
            }))
            cleanups.push(daemon.stop)
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
