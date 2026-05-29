// Shared test harness for `liveTransport` HTTP round-trip tests.
//
// Spins up `createHeadlessServer` against per-test temp projects so the
// client under test exercises actual HTTP + bearer auth + JSON-RPC
// envelopes. No mocks; no voicetree-mcp coupling — graph-tools' own headless
// server speaks the same wire and gives us injectable catalogs for the
// error-envelope scenarios.

import {spawn, type ChildProcess} from 'node:child_process'
import {mkdtemp, realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {
    createHeadlessServer,
    type Catalog,
    type CatalogHandler,
    type HeadlessServer,
    type ToolResult,
} from '../../src/live/headlessServer'

// ── env scoping ────────────────────────────────────────────────────────────

export const ENV_KEYS_OF_INTEREST: readonly string[] = [
    'VOICETREE_DAEMON_URL',
    'VOICETREE_PROJECT_PATH',
    'VOICETREE_DAEMON_TIMEOUT_MS',
] as const

export function snapshotEnv(): Record<string, string | undefined> {
    const snap: Record<string, string | undefined> = {}
    for (const key of ENV_KEYS_OF_INTEREST) snap[key] = process.env[key]
    return snap
}

export function restoreEnv(snap: Record<string, string | undefined>): void {
    for (const key of ENV_KEYS_OF_INTEREST) {
        const value: string | undefined = snap[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
    }
}

// ── fixture serialized state ───────────────────────────────────────────────

export const PROJECT_ROOT: string = '/tmp/project'
export const SAMPLE_NODE: string = `${PROJECT_ROOT}/sample.md`
export const TASKS_FOLDER: string = `${PROJECT_ROOT}/tasks/`

export const FIXTURE_SERIALIZED_STATE = {
    graph: {
        nodes: {
            [SAMPLE_NODE]: {
                outgoingEdges: [],
                absoluteFilePathIsID: SAMPLE_NODE,
                contentWithoutYamlOrLinks: 'hello',
                nodeUIMetadata: {
                    color: {_tag: 'None'},
                    position: {_tag: 'Some', value: {x: 1, y: 2}},
                    additionalYAMLProps: [],
                },
            },
        },
        incomingEdgesIndex: [],
        nodeByBaseName: [['sample.md', [SAMPLE_NODE]]],
        unresolvedLinksIndex: [],
    },
    roots: {
        loaded: [PROJECT_ROOT],
        folderTree: [{
            name: 'project',
            absolutePath: PROJECT_ROOT,
            children: [],
            loadState: 'loaded' as const,
            isWriteTarget: true,
        }],
    },
    collapseSet: [] as string[],
    selection: [] as string[],
    layout: {positions: [[SAMPLE_NODE, {x: 1, y: 2}]] as [string, {x: number; y: number}][]},
    meta: {schemaVersion: 1 as const, revision: 3, mutatedAt: '2026-04-17T00:00:00.000Z'},
}

// ── stub daemon (HTTP via graph-tools' headless server) ────────────────────

export interface StubDaemon {
    readonly url: string
    readonly projectPath: string
    readonly token: string
    readonly port: number
    readonly stop: () => Promise<void>
}

export async function startStubDaemon(catalog: Catalog): Promise<StubDaemon> {
    const projectPath: string = await realpath(await mkdtemp(join(tmpdir(), 'vt-live-transport-')))
    const handle: HeadlessServer = await createHeadlessServer({projectPath, catalog})
    return {
        url: handle.url,
        projectPath: handle.projectPath,
        token: handle.token,
        port: handle.port,
        stop: handle.close,
    }
}

// ── happy-path catalog ─────────────────────────────────────────────────────

export interface MockServer {
    collapseSet: string[]
    revision: number
    rootsLoaded: string[]
    zoom: number | undefined
}

export function initialMockServer(): MockServer {
    return {
        collapseSet: [],
        revision: FIXTURE_SERIALIZED_STATE.meta.revision,
        rootsLoaded: [...FIXTURE_SERIALIZED_STATE.roots.loaded],
        zoom: undefined,
    }
}

function buildCurrentState(mock: MockServer): typeof FIXTURE_SERIALIZED_STATE {
    return {
        ...FIXTURE_SERIALIZED_STATE,
        roots: {...FIXTURE_SERIALIZED_STATE.roots, loaded: [...mock.rootsLoaded]},
        collapseSet: [...mock.collapseSet],
        layout: {
            ...FIXTURE_SERIALIZED_STATE.layout,
            ...(mock.zoom !== undefined ? {zoom: mock.zoom} : {}),
        },
        meta: {...FIXTURE_SERIALIZED_STATE.meta, revision: mock.revision},
    }
}

interface DispatchedCommand {
    readonly type: string
    readonly path?: string
    readonly state?: string
    readonly zoom?: number
}

export function buildHappyCatalog(mock: MockServer): Catalog {
    const handlers: Array<[string, CatalogHandler]> = [
        ['vt_get_live_state', async (): Promise<ToolResult> => ({
            ok: true,
            payload: buildCurrentState(mock),
        })],
        ['vt_dispatch_live_command', async (args: Record<string, unknown>): Promise<ToolResult> => {
            const command = args.command as DispatchedCommand
            const delta: {
                revision: number
                cause: unknown
                collapseAdded?: string[]
                layoutChanged?: {zoom?: number}
            } = {revision: mock.revision, cause: command}

            if (
                command.type === 'SetFolderState'
                && command.state === 'collapsed'
                && typeof command.path === 'string'
            ) {
                const folder = `${command.path}/`
                if (!mock.collapseSet.includes(folder)) mock.collapseSet.push(folder)
                mock.revision += 1
                delta.revision = mock.revision
                delta.collapseAdded = [folder]
            }
            if (command.type === 'SetZoom' && typeof command.zoom === 'number') {
                mock.zoom = command.zoom
                mock.revision += 1
                delta.revision = mock.revision
                delta.layoutChanged = {zoom: command.zoom}
            }
            return {ok: true, payload: {delta, revision: mock.revision}}
        }],
    ]
    return new Map(handlers)
}

// ── vt-headless bin runner (used by liveTransport.bin.test.ts) ─────────────

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT: string = resolve(TEST_FILE_DIR, '../../../../..')
const VT_HEADLESS_BIN: string = join(REPO_ROOT, 'packages/libraries/graph-tools/bin/vt-headless.ts')
const HEADLESS_START_TIMEOUT_MS: number = 15_000

export interface SpawnedHeadless {
    readonly url: string
    readonly projectPath: string
    readonly stop: () => Promise<void>
}

export async function spawnVtHeadless(projectPath: string): Promise<SpawnedHeadless> {
    const child: ChildProcess = spawn(
        process.execPath,
        ['--import', 'tsx', VT_HEADLESS_BIN, 'serve', '--project', projectPath, '--port', '0'],
        {cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe']},
    )

    let stdout: string = ''
    let stderr: string = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string): void => { stdout += chunk })
    child.stderr?.on('data', (chunk: string): void => { stderr += chunk })

    const url: string = await new Promise<string>((resolveUrl, rejectUrl) => {
        const timer: NodeJS.Timeout = setTimeout(() => {
            child.kill('SIGINT')
            rejectUrl(new Error(`vt-headless did not announce a URL. stdout=${stdout} stderr=${stderr}`))
        }, HEADLESS_START_TIMEOUT_MS)
        child.stdout?.on('data', (): void => {
            const match: RegExpMatchArray | null = stdout.match(/Listening on (http:\/\/\S+)/)
            if (!match) return
            clearTimeout(timer)
            resolveUrl(match[1].trim())
        })
        child.once('exit', (code: number | null): void => {
            clearTimeout(timer)
            rejectUrl(new Error(`vt-headless exited early with ${code}. stdout=${stdout} stderr=${stderr}`))
        })
    })

    return {
        url,
        projectPath,
        stop: async (): Promise<void> => {
            if (child.exitCode !== null) return
            child.kill('SIGINT')
            await new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()))
        },
    }
}
