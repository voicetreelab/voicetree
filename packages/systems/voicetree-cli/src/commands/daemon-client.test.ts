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
    readonly projectPath: string
    readonly url: string
    readonly token: string
    readonly stop: () => Promise<void>
}

async function makeProject(prefix: string): Promise<string> {
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
    const projectPath: string = await makeProject('vt-daemon-client-')
    const token: string = generateAuthToken()
    await writeAuthTokenFile(projectPath, token)
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
    await writeRpcPortFile(projectPath, raw.port)
    return {projectPath, url: raw.url, token, stop: raw.close}
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
        'VOICETREE_PROJECT_PATH',
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
    delete process.env.VOICETREE_PROJECT_PATH
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
        tempDirs.push(daemon.projectPath)
        process.chdir(daemon.projectPath)

        const result: unknown = await callDaemon('search_nodes', {query: 'a'})
        expect(result).toEqual(expectedPayload)
    })

    it('-32003 tool_handler_failed envelope: surfaces the tool error sentence as plain text (no nested JSON blob)', async () => {
        // The daemon dispatcher sets error.data to the PARSED tool error object,
        // which for the agent/graph tool family is `{success:false, error:'<sentence>'}`.
        // The CLI must print the sentence, never a re-stringified JSON object.
        const sentence: string = 'Node a.md already exists in the graph'
        const daemon = await startStubDaemon('create_graph', async () => ({
            type: 'error',
            code: ERROR_CODES.tool_handler_failed,
            message: 'Tool handler returned an error response',
            data: {success: false, error: sentence},
        }))
        cleanups.push(daemon.stop)
        tempDirs.push(daemon.projectPath)
        process.chdir(daemon.projectPath)

        const err: unknown = await callDaemon('create_graph', {batch: []}).catch((e: unknown) => e)
        const message: string = (err as Error).message
        expect(message).toBe(sentence)
        expect(message).not.toContain('{')
        expect(message).not.toContain('"success"')
    })

    it('-32003 tool_handler_failed envelope: reads the sentence from a {ok:false,error} payload too', async () => {
        const sentence: string = 'cannot apply graph delta'
        const daemon = await startStubDaemon('create_graph', async () => ({
            type: 'error',
            code: ERROR_CODES.tool_handler_failed,
            message: 'Tool handler returned an error response',
            data: {ok: false, error: sentence},
        }))
        cleanups.push(daemon.stop)
        tempDirs.push(daemon.projectPath)
        process.chdir(daemon.projectPath)

        await expect(callDaemon('create_graph', {batch: []})).rejects.toMatchObject({message: sentence})
    })

    it('-32003 tool_handler_failed envelope: caller-gated failure hints the headless-safe .md authoring path', async () => {
        const sentence: string = 'Unknown caller terminal: term-xyz'
        const daemon = await startStubDaemon('spawn_agent', async () => ({
            type: 'error',
            code: ERROR_CODES.tool_handler_failed,
            message: 'Tool handler returned an error response',
            data: {success: false, error: sentence},
        }))
        cleanups.push(daemon.stop)
        tempDirs.push(daemon.projectPath)
        process.chdir(daemon.projectPath)

        const err: unknown = await callDaemon('spawn_agent', {}).catch((e: unknown) => e)
        const message: string = (err as Error).message
        expect(message).toContain(sentence)
        // Hints the filesystem-mode authoring path as the headless-safe write path.
        expect(message).toContain('vt graph create <file.md>')
        // Still a plain sentence — no nested JSON blob.
        expect(message).not.toContain('{"')
    })

    it('-32003 tool_handler_failed envelope: falls back to the envelope message when data carries no sentence', async () => {
        const daemon = await startStubDaemon('create_graph', async () => ({
            type: 'error',
            code: ERROR_CODES.tool_handler_failed,
            message: 'Tool handler returned an error response',
            data: {success: false},
        }))
        cleanups.push(daemon.stop)
        tempDirs.push(daemon.projectPath)
        process.chdir(daemon.projectPath)

        await expect(callDaemon('create_graph', {batch: []})).rejects.toMatchObject({
            message: 'Tool handler returned an error response',
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
        tempDirs.push(daemon.projectPath)
        process.chdir(daemon.projectPath)

        await expect(callDaemon('search_nodes', {})).rejects.toMatchObject({
            message: JSON.stringify({kind: 'validation_failed', data: expectedData}),
        })
    })

    it('first-call 401 with stale token-on-disk: retry-after-disk-refresh succeeds', async () => {
        const project: string = await makeProject('vt-401-fresh-')
        tempDirs.push(project)
        const staleToken: string = generateAuthToken()
        const currentToken: string = generateAuthToken()
        await writeAuthTokenFile(project, staleToken)

        const tokenFile: string = authTokenFilePath(project)
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
        await writeRpcPortFile(project, raw.port)
        process.chdir(project)

        const result: unknown = await callDaemon('search_nodes', {q: 'x'})
        expect(result).toEqual({ok: true, after: 'retry'})
    })

    it('first-call 401 with disk token still bad: retries once then throws DaemonAuthRequired naming the token file', async () => {
        const project: string = await makeProject('vt-401-exhaust-')
        tempDirs.push(project)
        const wrongToken: string = generateAuthToken()
        await writeAuthTokenFile(project, wrongToken)

        let authRequiredCount: number = 0
        const raw = await startRawServer((req, res) => {
            void readBody(req).then(() => {
                authRequiredCount += 1
                res.statusCode = 401
                res.end()
            })
        })
        cleanups.push(raw.close)
        await writeRpcPortFile(project, raw.port)
        process.chdir(project)

        const tokenFile: string = authTokenFilePath(project)
        await expect(callDaemon('search_nodes', {})).rejects.toMatchObject({
            name: 'DaemonAuthRequired',
            message: expect.stringContaining(tokenFile),
        })
        expect(authRequiredCount).toBe(2)
    })

    it('timeout exceeded: throws DaemonTimeout; underlying fetch was aborted (no response received)', async () => {
        const project: string = await makeProject('vt-timeout-')
        tempDirs.push(project)
        const token: string = generateAuthToken()
        await writeAuthTokenFile(project, token)

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
        await writeRpcPortFile(project, raw.port)
        process.chdir(project)
        process.env.VOICETREE_DAEMON_TIMEOUT_MS = '120'

        const err: unknown = await callDaemon('search_nodes', {}).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(DaemonTimeout)
        expect((err as Error).message).toContain('did not respond')
        // Allow the server to observe the abort before we tear it down.
        await new Promise((r) => setTimeout(r, 20))
        expect(observedAbort).toBe(true)
    })

    it('ECONNREFUSED (daemon not running at the port): throws DaemonUnreachable', async () => {
        const project: string = await makeProject('vt-econnrefused-')
        tempDirs.push(project)
        await writeAuthTokenFile(project, generateAuthToken())

        const placeholder = await startRawServer(() => {})
        const deadPort: number = placeholder.port
        await placeholder.close()
        await writeRpcPortFile(project, deadPort)
        process.chdir(project)

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
            tempDirs.push(winning.projectPath)

            const losing = await startStubDaemon('search_nodes', async () => ({
                type: 'ok',
                payload: {via: 'cwd_up_walk'},
            }))
            cleanups.push(losing.stop)
            tempDirs.push(losing.projectPath)

            process.chdir(losing.projectPath)
            process.env.VOICETREE_DAEMON_URL = winning.url
            process.env.VOICETREE_PROJECT_PATH = winning.projectPath

            const result: unknown = await callDaemon('search_nodes', {})
            expect(result).toEqual({via: 'env_url'})
        })

        it('stale env URL falls back to the project rpc.port endpoint', async () => {
            const live = await startStubDaemon('search_nodes', async () => ({
                type: 'ok',
                payload: {via: 'project_rpc_port'},
            }))
            cleanups.push(live.stop)
            tempDirs.push(live.projectPath)

            const stale = await startRawServer(() => {})
            const staleUrl: string = stale.url
            await stale.close()

            process.chdir(live.projectPath)
            process.env.VOICETREE_DAEMON_URL = staleUrl
            process.env.VOICETREE_PROJECT_PATH = live.projectPath

            const result: unknown = await callDaemon('search_nodes', {})
            expect(result).toEqual({via: 'project_rpc_port'})
        })

        it('cwd up-walk wins when env URL is unset (only port file present)', async () => {
            const daemon = await startStubDaemon('search_nodes', async () => ({
                type: 'ok',
                payload: {via: 'cwd_up_walk'},
            }))
            cleanups.push(daemon.stop)
            tempDirs.push(daemon.projectPath)
            process.chdir(daemon.projectPath)

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
            expect(msg).toContain('VOICETREE_PROJECT_PATH')
        })
    })
})
