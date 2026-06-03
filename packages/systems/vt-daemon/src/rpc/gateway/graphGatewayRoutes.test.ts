// Black-box gateway-parity test (RE-PLAN B). Boots a REAL vt-graphd, points a
// REAL @vt/graph-db-client at it, builds the graph.* routes via the factory,
// and asserts each route's result equals what the same op returns hitting the
// graphd client directly — and that mutations have the observable side effect
// (re-read the graph, not "was called"). No internal mocks. The full POST /rpc
// dispatch path (zod validation + the buildCatalogDispatchMap merge) is
// exercised end-to-end by the live-update integration test in transport/tests.

import {mkdir, mkdtemp, readdir, stat, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, test} from 'vitest'

import {startDaemon, type DaemonHandle} from '@vt/graph-db-server'
import {createGraphDbClient, type GraphDbClientApi} from '@vt/graph-db-client'
import {GRAPH_GATEWAY_METHODS} from '@vt/vt-daemon-protocol'
import {VOICETREE_HOME_PATH_ENV} from '@vt/paths'

import {buildGraphGatewayRoutes} from './graphGatewayRoutes.ts'
import type {RpcRoute} from '../RpcRoute.ts'

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
    let priorHome: string | undefined

    beforeEach(async () => {
        root = await mkdtemp(path.join(tmpdir(), 'graph-gateway-'))
        project = path.join(root, 'project')
        await mkdir(project, {recursive: true})
        voicetreeHome = await createVoicetreeHome(project)
        // The folder routes' settings IO (starred folders) resolves the home from
        // this env var; point it at the test home so they never touch real config.
        priorHome = process.env[VOICETREE_HOME_PATH_ENV]
        process.env[VOICETREE_HOME_PATH_ENV] = voicetreeHome
        await writeFile(path.join(voicetreeHome, 'settings.json'), JSON.stringify({starredFolders: []}))

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
        if (priorHome === undefined) delete process.env[VOICETREE_HOME_PATH_ENV]
        else process.env[VOICETREE_HOME_PATH_ENV] = priorHome
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

    // --- Folders (browser-mode daemon-served folder browser) -----------------

    test('graph.getFolderTreeSync returns the project root tree + project paths', async () => {
        await mkdir(path.join(project, 'notes'))
        const payload = await invoke(M.getFolderTreeSync) as {
            rootTree: {name: string; children: {name: string}[]} | null
            readPaths: string[]
            writeFolderPath: string
            starredFolders: string[]
        }
        expect(payload.rootTree?.name).toBe(path.basename(project))
        expect(payload.rootTree?.children.map((c) => c.name)).toContain('notes')
        expect(payload.writeFolderPath).toBe((await client.getProject()).writeFolderPath)
        expect(payload.starredFolders).toEqual([])
    })

    test('graph.getAvailableFolders lists project subfolders', async () => {
        await mkdir(path.join(project, 'archive'))
        const folders = await invoke(M.getAvailableFolders, {searchQuery: ''}) as {displayPath: string}[]
        expect(folders.map((f) => f.displayPath)).toContain('archive')
    })

    test('graph.getDirectoryTree honours the allowlist (null outside the project)', async () => {
        const inside = await invoke(M.getDirectoryTree, {rootPath: project}) as {name: string} | null
        expect(inside?.name).toBe(path.basename(project))
        const outside = await mkdtemp(path.join(tmpdir(), 'outside-'))
        try {
            expect(await invoke(M.getDirectoryTree, {rootPath: outside})).toBeNull()
        } finally {
            await rm(outside, {recursive: true, force: true})
        }
    })

    test('graph.createSubfolder creates the folder; outside the allowlist it fails without writing', async () => {
        const ok = await invoke(M.createSubfolder, {parentPath: project, folderName: 'fresh'}) as {success: boolean}
        expect(ok.success).toBe(true)
        expect((await stat(path.join(project, 'fresh'))).isDirectory()).toBe(true)

        const outside = await mkdtemp(path.join(tmpdir(), 'outside-'))
        try {
            const denied = await invoke(M.createSubfolder, {parentPath: outside, folderName: 'x'}) as {success: boolean}
            expect(denied.success).toBe(false)
            expect(await readdir(outside)).toEqual([])
        } finally {
            await rm(outside, {recursive: true, force: true})
        }
    })

    test('graph.writeMarkdownFile rejects a target outside the allowlist without writing it', async () => {
        const outside = await mkdtemp(path.join(tmpdir(), 'outside-'))
        const escapeTarget = path.join(outside, 'evil.md')
        try {
            await expect(invoke(M.writeMarkdownFile, {
                absolutePath: escapeTarget,
                body: '# pwned\n',
                editorId: 'e1',
            })).rejects.toThrow(/allowlist/)
            expect(await readdir(outside)).toEqual([]) // nothing written outside the project
        } finally {
            await rm(outside, {recursive: true, force: true})
        }
    })

    test('graph.setWriteFolderPath rejects a path outside the allowlist', async () => {
        const outside = await mkdtemp(path.join(tmpdir(), 'outside-'))
        try {
            await expect(invoke(M.setWriteFolderPath, {path: outside})).rejects.toThrow(/allowlist/)
            // The write folder is unchanged — the escape never took effect.
            expect((await client.getProject()).writeFolderPath).not.toBe(outside)
        } finally {
            await rm(outside, {recursive: true, force: true})
        }
    })

    test('graph.createDatedVoiceTreeFolder creates a dated folder and points the write path at it', async () => {
        const result = await invoke(M.createDatedVoiceTreeFolder) as {success: boolean; path?: string}
        expect(result.success).toBe(true)
        expect(result.path).toBeDefined()
        expect((await stat(result.path!)).isDirectory()).toBe(true)
        expect((await client.getProject()).writeFolderPath).toBe(result.path)
    })

    test('graph.addStarredFolder (in-allowlist) is observable; out-of-allowlist is ignored', async () => {
        const starred = path.join(project, 'starred')
        await mkdir(starred)
        await invoke(M.addStarredFolder, {folderPath: starred})
        expect(await invoke(M.getStarredFolders)).toEqual([starred])

        // A path outside the project must never be starred (it would be scanned).
        const outside = await mkdtemp(path.join(tmpdir(), 'outside-'))
        try {
            await invoke(M.addStarredFolder, {folderPath: outside})
            expect(await invoke(M.getStarredFolders)).toEqual([starred])
        } finally {
            await rm(outside, {recursive: true, force: true})
        }

        await invoke(M.removeStarredFolder, {folderPath: starred})
        expect(await invoke(M.getStarredFolders)).toEqual([])
    })

    test('graph.copyNodeToFolder copies a node markdown into a project subfolder', async () => {
        const notePath = path.join(project, 'src-note.md')
        await invoke(M.writeMarkdownFile, {
            absolutePath: notePath,
            body: '# Copy Me\n\nbody',
            editorId: 'copy-test',
        })
        await mkdir(path.join(project, 'dest'))

        const result = await invoke(M.copyNodeToFolder, {
            nodeId: notePath,
            targetFolderPath: path.join(project, 'dest'),
        }) as {success: boolean; targetPath: string}
        expect(result.success).toBe(true)
        expect((await stat(result.targetPath)).isFile()).toBe(true)
        expect(result.targetPath).toBe(path.join(project, 'dest', 'copy-me.md'))
    })
})
