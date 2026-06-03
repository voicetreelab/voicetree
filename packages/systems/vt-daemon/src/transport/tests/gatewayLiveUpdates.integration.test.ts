// End-to-end gateway live-update proof (RE-PLAN B). Boots a REAL vt-graphd and a
// REAL VTD wired as the gateway (graph.* routes + the projectedGraph→hub pump),
// connects a WebSocket to VTD's /events, subscribes to topic 'graph', and drives
// graph mutations through POST /rpc. Asserts the browser-shape WS receives a
// projectedGraph frame reflecting the mutation — exercising the full stack:
// JSON-RPC dispatch + zod validation + the catalog extra-routes merge + the
// pump + the hub 'graph' topic + WS delivery. No internal mocks; real servers.

import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import {WebSocket} from 'ws'

import {generateAuthToken} from '@vt/vt-rpc'
import {startDaemon, type DaemonHandle} from '@vt/graph-db-server'
import {createGraphDbClient, type GraphDbClientApi} from '@vt/graph-db-client'
import {GRAPH_GATEWAY_METHODS} from '@vt/vt-daemon-protocol'

import {startHttpDaemonServer, type HttpDaemonServerHandle} from '../httpServer.ts'
import {buildCatalogDispatchMap} from '../../tools/catalog.ts'
import {buildGraphGatewayRoutes} from '../../rpc/gateway/graphGatewayRoutes.ts'
import {createGatewayLiveUpdates} from '../gatewayLiveUpdates.ts'
import {buildGdbGraphBridge} from '../../config/gdbGraphBridge.ts'

interface GraphFrame {
    readonly type: string
    readonly topic: string
    readonly event: string
    readonly data: {readonly nodes: ReadonlyArray<{readonly id: string; readonly basename?: string}>}
}

async function createVoicetreeHome(project: string): Promise<string> {
    const voicetreeHome = await mkdtemp(path.join(tmpdir(), 'gateway-live-home-'))
    await writeFile(
        path.join(voicetreeHome, 'voicetree-config.json'),
        JSON.stringify({projectConfig: {[project]: {writeFolderPath: project}}}),
    )
    return voicetreeHome
}

const delay = (ms: number): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

describe('gateway live updates — graphd projectedGraph → VTD /events topic graph', () => {
    let root: string
    let project: string
    let voicetreeHome: string
    let graphd: DaemonHandle | null
    let vtd: HttpDaemonServerHandle | null
    let client: GraphDbClientApi
    let token: string
    let liveUpdates: ReturnType<typeof createGatewayLiveUpdates>

    beforeEach(async () => {
        root = await mkdtemp(path.join(tmpdir(), 'gateway-live-'))
        project = path.join(root, 'project')
        await mkdir(project, {recursive: true})
        voicetreeHome = await createVoicetreeHome(project)

        graphd = await startDaemon({project, voicetreeHomePath: voicetreeHome, createStarterIfEmpty: false})
        client = createGraphDbClient({baseUrl: `http://127.0.0.1:${graphd.port}`})
        token = generateAuthToken()

        let handleRef: HttpDaemonServerHandle
        liveUpdates = createGatewayLiveUpdates({
            client,
            publishGraphSnapshot: (snapshot): void => handleRef.hub.publish('graph', 'projectedGraph', snapshot),
        })
        const catalog = buildCatalogDispatchMap(
            {graph: buildGdbGraphBridge(client, project)},
            buildGraphGatewayRoutes({client, ensureSession: liveUpdates.ensureSession}),
        )
        vtd = await startHttpDaemonServer({
            catalog,
            hookHandler: (): unknown => ({ok: true}),
            token,
            bindHost: '127.0.0.1',
            canonicalProject: project,
            logger: {logRequest: (): void => {}, logError: (): void => {}},
        })
        handleRef = vtd
    })

    afterEach(async () => {
        liveUpdates?.stop()
        await vtd?.stop().catch(() => {})
        await graphd?.stop().catch(() => {})
        await rm(root, {recursive: true, force: true})
        await rm(voicetreeHome, {recursive: true, force: true})
    }, 15000)

    async function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        const res = await fetch(`${vtd!.url}/rpc`, {
            method: 'POST',
            headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
            body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
        })
        const body = await res.json() as {result?: unknown; error?: unknown}
        if (body.error) throw new Error(`rpc ${method} error: ${JSON.stringify(body.error)}`)
        return body.result
    }

    test('a graph.writeMarkdownFile mutation is broadcast as a projectedGraph frame on topic graph', async () => {
        const graphFrames: GraphFrame[] = []
        const ws = new WebSocket(`${vtd!.url.replace(/^http/, 'ws')}/events`, ['vt-bearer', token])
        await new Promise<void>((r, reject) => {
            ws.once('open', () => r())
            ws.once('error', reject)
        })
        ws.on('message', (raw: Buffer): void => {
            const frame = JSON.parse(raw.toString('utf8')) as GraphFrame
            if (frame.type === 'event' && frame.topic === 'graph') graphFrames.push(frame)
        })
        ws.send(JSON.stringify({op: 'subscribe', topics: [{topic: 'graph'}]}))
        await delay(50)

        // openProject starts VTD's single graphd session + the live pump. graphd
        // emits an initial projectedGraph on SSE open → first frame on topic graph.
        const boot = await rpc(GRAPH_GATEWAY_METHODS.openProject) as {sessionId: string}
        expect(typeof boot.sessionId).toBe('string')

        // Mutate: write a node. graphd re-emits projectedGraph → pump → hub → WS.
        const notePath = path.join(project, 'live-note.md')
        await rpc(GRAPH_GATEWAY_METHODS.writeMarkdownFile, {
            absolutePath: notePath,
            body: '# Live note\n\nshould appear in a projectedGraph frame.\n',
            editorId: 'live-test',
        })

        // Wait for a frame whose snapshot contains the new node.
        const deadline = Date.now() + 4000
        let matched: GraphFrame | undefined
        while (Date.now() < deadline && !matched) {
            matched = graphFrames.find(f => f.data.nodes.some(n => n.id === notePath || n.basename === 'live-note.md'))
            if (!matched) await delay(50)
        }
        ws.close()

        expect(matched, `no graph frame contained the new node; saw ${graphFrames.length} graph frame(s)`).toBeTruthy()
        expect(matched!.event).toBe('projectedGraph')
    }, 20000)
})
