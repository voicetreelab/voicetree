// Black-box gateway-parity test (RE-PLAN B). Boots a REAL vt-graphd, points a
// REAL @vt/graph-db-client at it, builds the graph.* routes via the factory,
// and asserts each route's result equals what the same op returns hitting the
// graphd client directly — and that mutations have the observable side effect
// (re-read the graph, not "was called"). No internal mocks. The full POST /rpc
// dispatch path (zod validation + the buildCatalogDispatchMap merge) is
// exercised end-to-end by the live-update integration test in transport/tests.

import {mkdir, mkdtemp, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import {startDaemon, type DaemonHandle} from '@vt/graph-db-server'
import {createGraphDbClient, type GraphDbClientApi} from '@vt/graph-db-client'
import {GRAPH_GATEWAY_METHODS} from '@vt/vt-daemon-protocol'

import {buildGraphGatewayRoutes} from './graphGatewayRoutes.ts'
import type {RpcRoute} from './RpcRoute.ts'

const M = GRAPH_GATEWAY_METHODS

async function createVoicetreeHome(project: string): Promise<string> {
    const voicetreeHome = await mkdtemp(path.join(tmpdir(), 'graph-gateway-home-'))
    await writeFile(
        path.join(voicetreeHome, 'voicetree-config.json'),
        JSON.stringify({projectConfig: {[project]: {writeFolderPath: project}}}),
    )
    return voicetreeHome
}

describe('graph.* gateway routes (real graphd roundtrip)', () => {
    let root: string
    let project: string
    let voicetreeHome: string
    let handle: DaemonHandle | null
    let client: GraphDbClientApi
    let invoke: (method: string, args?: Record<string, unknown>) => Promise<unknown>

    beforeEach(async () => {
        root = await mkdtemp(path.join(tmpdir(), 'graph-gateway-'))
        project = path.join(root, 'project')
        await mkdir(project, {recursive: true})
        voicetreeHome = await createVoicetreeHome(project)

        handle = await startDaemon({project, voicetreeHomePath: voicetreeHome, createStarterIfEmpty: false})
        client = createGraphDbClient({baseUrl: `http://127.0.0.1:${handle.port}`})

        // VTD owns ONE graphd session for the project; ensureSession is
        // idempotent so every session-scoped route threads the same id.
        let sid: string | null = null
        const ensureSession = async (): Promise<string> => {
            if (sid === null) sid = (await client.createSession()).sessionId
            return sid
        }

        const routes: readonly RpcRoute[] = buildGraphGatewayRoutes({client, ensureSession})
        const byName = new Map(routes.map((r): [string, RpcRoute] => [r.name, r]))
        invoke = async (method: string, args: Record<string, unknown> = {}): Promise<unknown> => {
            const route = byName.get(method)
            if (!route) throw new Error(`no gateway route for ${method}`)
            const res = await route.handler(args)
            const text: string = res.content[0]?.text ?? ''
            return text === '' ? null : JSON.parse(text)
        }
    })

    afterEach(async () => {
        await handle?.stop().catch(() => {})
        await rm(root, {recursive: true, force: true})
        await rm(voicetreeHome, {recursive: true, force: true})
    }, 15000)

    test('graph.getProject equals the direct graphd read', async () => {
        expect(await invoke(M.getProject)).toEqual(await client.getProject())
    })

    test('graph.getGraph equals the direct graphd read', async () => {
        expect(await invoke(M.getGraph)).toEqual(await client.getGraph())
    })

    test('graph.openProject returns one session + project state + initial projected graph', async () => {
        const boot = await invoke(M.openProject) as {
            sessionId: string
            projectState: unknown
            initialProjectedGraph: {nodes: unknown[]}
        }
        expect(typeof boot.sessionId).toBe('string')
        expect(boot.sessionId.length).toBeGreaterThan(0)
        expect(boot.projectState).toEqual(await client.getProject())
        expect(Array.isArray(boot.initialProjectedGraph.nodes)).toBe(true)

        // Idempotent: a second openProject threads the SAME session id.
        const boot2 = await invoke(M.openProject) as {sessionId: string}
        expect(boot2.sessionId).toBe(boot.sessionId)
    })

    test('graph.writeMarkdownFile is observable via graph.getNode and graph.findFileByName', async () => {
        const notePath = path.join(project, 'gateway-note.md')
        const body = '# Gateway note\n\nWritten through the gateway.\n'

        const written = await invoke(M.writeMarkdownFile, {
            absolutePath: notePath,
            body,
            editorId: 'gateway-test',
        }) as {ok: true; absolutePath: string}
        expect(written.ok).toBe(true)
        expect(written.absolutePath).toBe(notePath)

        const node = await invoke(M.getNode, {nodeId: notePath}) as {contentWithoutYamlOrLinks: string} | null
        expect(node?.contentWithoutYamlOrLinks).toBe(body)

        // find-file matches on the filename stem (it appends `.md` to the glob).
        const matches = await invoke(M.findFileByName, {name: 'gateway-note'}) as string[]
        expect(matches).toEqual(await client.findFileByName('gateway-note'))
        expect(matches).toContain(notePath)
    })

    test('graph.getNode returns null for an unknown node', async () => {
        expect(await invoke(M.getNode, {nodeId: path.join(project, 'nope.md')})).toBeNull()
    })

    test('graph.listViews equals the direct graphd read', async () => {
        const views = await invoke(M.listViews)
        expect(Array.isArray(views)).toBe(true)
        expect(views).toEqual(await client.views.list())
    })

    test('graph.getProjectedGraph threads the owned session and equals the direct read', async () => {
        const sid = (await invoke(M.openProject) as {sessionId: string}).sessionId
        const viaGateway = await invoke(M.getProjectedGraph) as {nodes: unknown[]}
        const direct = await client.getProjectedGraph(sid) as {nodes: unknown[]}
        expect(Array.isArray(viaGateway.nodes)).toBe(true)
        expect(viaGateway.nodes.length).toBe(direct.nodes.length)
    })
})
