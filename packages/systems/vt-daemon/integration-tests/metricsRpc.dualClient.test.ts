// BF-382 — the C4 principle, made executable for the metrics surface.
//
// Anything VTD owns must be reachable identically by every client. Electron
// Main and the CLI are just two clients. This test boots the full daemon
// stack (real OTLP receiver + real vt-daemon HTTP server) against a tmpdir
// project, then:
//
//   1. POSTs a fixture OTLP body to <port>/v1/metrics — the OTLP wire path,
//      not JSON-RPC. The daemon ingests, parses, and persists.
//   2. Constructs two JSON-RPC clients via `createRpcClientForProject` (the
//      same constructor Main and CLI both use post-cutover).
//   3. Reads `metrics.getSessions` from each; asserts byte-identical
//      responses via `JSON.stringify(a) === JSON.stringify(b)`.
//
// Negative case: `metrics.appendSession` rejected by zod (missing required
// fields) yields the identical JSON-RPC `validation_failed` error shape
// from both clients.
//
// No internal mocks. Real HTTP both for OTLP ingest and JSON-RPC reads.

import {beforeAll, afterAll, describe, expect, it} from 'vitest'
import {mkdir, mkdtemp, realpath, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
    createRpcClientForProject,
    generateAuthToken,
    writeAuthTokenFile,
    writeRpcPortFile,
    type DaemonRpcClient,
    type JsonRpcResponse,
} from '@vt/vt-rpc'

import {
    startOtlpReceiver,
    stopOtlpReceiver,
} from '../src/observability/otlpReceiver.ts'
import {buildDefaultToolCatalog} from '../src/transport/toolCatalog.ts'
import {setCurrentProject} from '../src/state/currentProject.ts'
import {startHttpDaemonServer, type HttpDaemonServerHandle} from '../src/transport/httpServer.ts'
import {readOtlpPortFile} from '../src/lifecycle/otlpPortFile.ts'
import {buildDisabledMcpBridges} from './__helpers__/disabledMcpBridges.ts'

interface FullStack {
    readonly project: string
    readonly rpc: HttpDaemonServerHandle
    readonly otlpPort: number
    readonly stop: () => Promise<void>
}

function buildFixtureOtlpRequest(sessionId: string): unknown {
    return {
        resourceMetrics: [
            {
                resource: {attributes: []},
                scopeMetrics: [
                    {
                        metrics: [
                            {
                                name: 'claude_code.token.usage',
                                sum: {
                                    dataPoints: [
                                        {
                                            attributes: [
                                                {key: 'session.id', value: {stringValue: sessionId}},
                                                {key: 'type', value: {stringValue: 'input'}},
                                            ],
                                            asInt: '500',
                                        },
                                        {
                                            attributes: [
                                                {key: 'session.id', value: {stringValue: sessionId}},
                                                {key: 'type', value: {stringValue: 'output'}},
                                            ],
                                            asInt: '700',
                                        },
                                    ],
                                },
                            },
                            {
                                name: 'claude_code.cost.usage',
                                sum: {
                                    dataPoints: [
                                        {
                                            attributes: [
                                                {key: 'session.id', value: {stringValue: sessionId}},
                                            ],
                                            asDouble: 0.012,
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            },
        ],
    }
}

async function startFullStack(): Promise<FullStack> {
    const root: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-metrics-dualclient-')))
    const project: string = join(root, 'project')
    await mkdir(project, {recursive: true})

    setCurrentProject(project)

    const token: string = generateAuthToken()
    await writeAuthTokenFile(project, token)

    const rpc: HttpDaemonServerHandle = await startHttpDaemonServer({
        catalog: buildDefaultToolCatalog(buildDisabledMcpBridges()),
        token,
        bindHost: '127.0.0.1',
        logger: {logRequest: (): void => {}, logError: (): void => {}},
    })
    await writeRpcPortFile(project, rpc.port)

    await startOtlpReceiver(project)
    const otlpPort: number | null = await readOtlpPortFile(project)
    if (otlpPort === null) {
        throw new Error('OTLP port file was not published after startOtlpReceiver')
    }

    return {
        project,
        rpc,
        otlpPort,
        stop: async (): Promise<void> => {
            await stopOtlpReceiver().catch((): void => {})
            await rpc.stop().catch((): void => {})
            setCurrentProject(null)
            await rm(root, {recursive: true, force: true})
        },
    }
}

describe('metrics.getSessions — identical client surface (C4)', (): void => {
    let stack: FullStack
    let clientMain: DaemonRpcClient
    let clientCli: DaemonRpcClient
    const sessionId: string = 'session-dualclient-001'

    beforeAll(async (): Promise<void> => {
        stack = await startFullStack()
        clientMain = await createRpcClientForProject(stack.project, {env: process.env})
        clientCli = await createRpcClientForProject(stack.project, {env: process.env})

        // Mutation: OTLP wire ingest (POST /v1/metrics). This is the
        // canonical Claude-Code path; from this point both clients see
        // the same persisted state via JSON-RPC.
        const response: Response = await fetch(`http://localhost:${stack.otlpPort}/v1/metrics`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(buildFixtureOtlpRequest(sessionId)),
        })
        if (response.status !== 200) {
            throw new Error(`OTLP ingest unexpectedly returned ${response.status}`)
        }
    }, 30_000)

    afterAll(async (): Promise<void> => {
        await stack.stop()
    })

    it('Main-as-client read surfaces the OTLP-ingested session', async (): Promise<void> => {
        const response: JsonRpcResponse = await clientMain.call('metrics.getSessions', {})
        if ('error' in response) {
            throw new Error(`metrics.getSessions unexpectedly failed: ${JSON.stringify(response.error)}`)
        }
        const result: {sessions: ReadonlyArray<{sessionId: string; tokens?: unknown; costUsd?: number}>} =
            response.result as {sessions: ReadonlyArray<{sessionId: string; tokens?: unknown; costUsd?: number}>}
        expect(result.sessions).toHaveLength(1)
        expect(result.sessions[0].sessionId).toBe(sessionId)
        expect(result.sessions[0].tokens).toEqual({input: 500, output: 700, cacheRead: 0})
        expect(result.sessions[0].costUsd).toBeCloseTo(0.012, 6)
    })

    it('two reads from different clients are byte-identical', async (): Promise<void> => {
        const a: JsonRpcResponse = await clientMain.call('metrics.getSessions', {})
        const b: JsonRpcResponse = await clientCli.call('metrics.getSessions', {})
        if ('error' in a || 'error' in b) {
            throw new Error('metrics.getSessions unexpectedly failed')
        }
        expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result))
    })

    it('CLI-as-client appendSession is observable to Main-as-client getSessions', async (): Promise<void> => {
        const appendResponse: JsonRpcResponse = await clientCli.call('metrics.appendSession', {
            sessionId: 'session-cli-appended-001',
            tokens: {input: 1, output: 2, cacheRead: 3},
            costUsd: 0.0001,
        })
        if ('error' in appendResponse) {
            throw new Error(`metrics.appendSession unexpectedly failed: ${JSON.stringify(appendResponse.error)}`)
        }
        expect(appendResponse.result).toBeNull()

        const readResponse: JsonRpcResponse = await clientMain.call('metrics.getSessions', {})
        if ('error' in readResponse) {
            throw new Error('metrics.getSessions unexpectedly failed')
        }
        const result: {sessions: ReadonlyArray<{sessionId: string}>} = readResponse.result as {
            sessions: ReadonlyArray<{sessionId: string}>
        }
        const ids: readonly string[] = result.sessions.map((s: {sessionId: string}): string => s.sessionId)
        expect(ids).toContain('session-cli-appended-001')
    })

    it('malformed metrics.appendSession surfaces the identical validation_failed shape on both clients', async (): Promise<void> => {
        // Missing required `tokens` and `costUsd` triggers the catalog's
        // zod validation path.
        const fromMain: JsonRpcResponse = await clientMain.call('metrics.appendSession', {sessionId: 'x'})
        const fromCli: JsonRpcResponse = await clientCli.call('metrics.appendSession', {sessionId: 'x'})
        if (!('error' in fromMain) || !('error' in fromCli)) {
            throw new Error('expected JSON-RPC error from both clients')
        }
        expect(fromMain.error.code).toBe(fromCli.error.code)
        expect(fromMain.error.message).toBe(fromCli.error.message)
        expect(JSON.stringify(fromMain.error.data)).toBe(JSON.stringify(fromCli.error.data))
    })
})
