/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Core } from 'cytoscape'
import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import * as fs from 'fs/promises'
import * as path from 'path'
import { vi } from 'vitest'
import type { Graph, GraphDelta, GraphNode } from '@vt/graph-model/graph'
import { applyGraphDeltaToGraph } from '@vt/graph-model/graph'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/actions/applyGraphDeltaToUI'
import { projectDelta, resetTestProjectionState } from '@/shell/edge/UI-edge/graph/integration-tests/projectGraphDelta'
import { initGraphModel } from '@vt/graph-model'
import { setProjectRoot as setDbServerProjectRoot } from '@vt/graph-db-server/state/watch-folder-store'
import { apply_graph_deltas_to_db } from '@vt/graph-db-server/graph/graphActionsToDBEffects'

const state: {
    currentGraph: Graph | null
    tempVault: string
    handlersImported: boolean
} = {
    currentGraph: null,
    tempVault: '',
    handlersImported: false
}

function applyDeltaToUI(cy: Core, delta: GraphDelta): ReturnType<typeof applyGraphDeltaToUI> {
    return applyGraphDeltaToUI(cy, projectDelta(delta))
}

async function applyDeltaToFilesystemAndState(cy: Core, delta: GraphDelta): Promise<void> {
    const result: E.Either<Error, GraphDelta> = await apply_graph_deltas_to_db(delta)({
        projectRoot: state.tempVault
    })()
    if (E.isLeft(result)) {
        throw result.left
    }
    if (state.currentGraph) {
        state.currentGraph = applyGraphDeltaToGraph(state.currentGraph, delta)
    }
    applyDeltaToUI(cy, delta)
}

function setCurrentGraph(graph: Graph): void {
    state.currentGraph = graph
}

function tempVault(): string {
    return state.tempVault
}

function vaultFilePath(filename: string): string {
    return path.join(state.tempVault, filename)
}

function createTestWindow(cy: Core, includeWriteFolderPath: boolean): Window {
    return {
        electronAPI: {
            main: {
                getGraph: async () => state.currentGraph,
                getNode: async (nodeId: string) => state.currentGraph?.nodes[nodeId],
                ...(includeWriteFolderPath
                    ? {
                        getWriteFolderPath: () => Promise.resolve(O.some(state.tempVault)),
                        getWatchStatus: () => ({ isWatching: false, directory: state.tempVault })
                    }
                    : {}),
                applyGraphDeltaToDBThroughMemUIAndEditorExposed: async (delta: GraphDelta) => {
                    await applyDeltaToFilesystemAndState(cy, delta)
                }
            }
        }
    } as unknown as Window
}

const { ipcMain } = vi.hoisted(() => {
    const ipcMain: { _handlers: Map<string, Function>; handle(channel: string, handler: Function): void; removeHandler(channel: string): void } = {
        _handlers: new Map<string, Function>(),
        handle(channel: string, handler: Function) {
            this._handlers.set(channel, handler)
        },
        removeHandler(channel: string) {
            this._handlers.delete(channel)
        }
    }
    return { ipcMain }
})

vi.mock('electron', () => ({
    ipcMain,
    dialog: {
        showOpenDialog: vi.fn()
    },
    app: {
        whenReady: () => Promise.resolve(),
        on: vi.fn(),
        quit: vi.fn(),
        getPath: vi.fn(() => '/tmp/test-userdata-nonexistent-' + Date.now())
    }
}))

vi.mock('posthog-js', () => ({
    default: {
        capture: vi.fn(),
        get_distinct_id: vi.fn(() => 'test-user-id')
    }
}))

vi.mock('@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity', async () => {
    const actual: typeof import('@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity') = await vi.importActual('@/shell/UI/views/treeStyleTerminalTabs/agentTabsActivity')
    return {
        ...actual,
        markTerminalActivityForContextNode: vi.fn()
    }
})

vi.mock('@/shell/edge/main/graph/watch_folder/watchFolder', async (importOriginal) => {
    const actual: typeof import('@/shell/edge/main/graph/watch_folder/watchFolder') = await importOriginal<typeof import('@/shell/edge/main/graph/watch_folder/watchFolder')>()
    return {
        ...actual,
        stopFileWatching: vi.fn().mockResolvedValue({ success: true }),
        getWatchStatus: vi.fn(() => ({ isWatching: false, directory: undefined })),
        isWatching: vi.fn(() => false),
    }
})

async function ensureHandlersImported(): Promise<void> {
    // Post-vt-daemon migration: terminal IPC handlers moved into the vt-daemon
    // process. The webapp main side no longer registers Electron-side IPC
    // handlers for terminals — vt-daemon's RPC routes own that surface now.
    // Kept as a no-op so the rest of the test setup chain is unchanged.
    state.handlersImported = true
}

async function setupDeleteFilesystemTest(): Promise<void> {
    resetTestProjectionState()
    await setupFilesystemTest('test-vault-delete-edges')
}

async function setupMergeFilesystemTest(vaultPrefix: string): Promise<void> {
    await setupFilesystemTest(vaultPrefix)
}

async function setupFilesystemTest(vaultPrefix: string): Promise<void> {
    state.currentGraph = null
    initGraphModel({})
    await ensureHandlersImported()
    state.tempVault = path.join('/tmp', `${vaultPrefix}-${Date.now()}`)
    await fs.mkdir(state.tempVault, { recursive: true })
    setDbServerProjectRoot(state.tempVault)
}

async function cleanupFilesystemTest(cy: Core | undefined): Promise<void> {
    cy?.destroy()
    await fs.rm(state.tempVault, { recursive: true, force: true })
    state.currentGraph = null
    setDbServerProjectRoot(null)
    state.tempVault = ''
    vi.clearAllMocks()
}

function createTestNode(
    id: string,
    content: string,
    outgoingEdges: readonly { targetId: string; label: string }[] = [],
    position?: { x: number; y: number },
    isContextNode: boolean = false
): GraphNode {
    return {
        absoluteFilePathIsID: id,
        outgoingEdges,
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: position ? O.some(position) : O.none,
            additionalYAMLProps: {},
            isContextNode
        }
    }
}

async function writeMarkdownFile(
    projectRoot: string,
    filename: string,
    content: string,
    wikilinks: string[] = [],
    position?: { x: number; y: number }
): Promise<void> {
    const frontmatter: string = position
        ? `---\nposition:\n  x: ${position.x}\n  y: ${position.y}\n---\n`
        : ''
    const linksSection: string = wikilinks.length > 0
        ? `\n\n_Links:_\n${wikilinks.map(link => `- [[${link}]]`).join('\n')}`
        : ''
    const fullContent: string = `${frontmatter}${content}${linksSection}`
    await fs.writeFile(path.join(projectRoot, filename), fullContent)
}

async function readWikilinksFromFile(filePath: string): Promise<string[]> {
    const content: string = await fs.readFile(filePath, 'utf-8')
    const wikiLinkRegex: RegExp = /\[\[([^\]]+)\]\]/g
    const matches: string[] = []
    let match: RegExpExecArray | null
    while ((match = wikiLinkRegex.exec(content)) !== null) {
        matches.push(match[1])
    }
    return matches
}

async function fileExists(filePath: string): Promise<boolean> {
    return fs.access(filePath).then(() => true).catch(() => false)
}

async function readVaultDirectory(): Promise<string[]> {
    return fs.readdir(state.tempVault)
}

async function readVaultFile(filename: string): Promise<string> {
    return fs.readFile(vaultFilePath(filename), 'utf-8')
}

function basename(filePath: string): string {
    return path.basename(filePath)
}

export function createDeleteAndMergeFilesystemTestSupport(): {
    basename: typeof basename
    cleanupFilesystemTest: typeof cleanupFilesystemTest
    createTestNode: typeof createTestNode
    createTestWindow: typeof createTestWindow
    fileExists: typeof fileExists
    readVaultDirectory: typeof readVaultDirectory
    readVaultFile: typeof readVaultFile
    readWikilinksFromFile: typeof readWikilinksFromFile
    setCurrentGraph: typeof setCurrentGraph
    setupDeleteFilesystemTest: typeof setupDeleteFilesystemTest
    setupMergeFilesystemTest: typeof setupMergeFilesystemTest
    tempVault: typeof tempVault
    vaultFilePath: typeof vaultFilePath
    writeMarkdownFile: typeof writeMarkdownFile
} {
    return {
        basename,
        cleanupFilesystemTest,
        createTestNode,
        createTestWindow,
        fileExists,
        readVaultDirectory,
        readVaultFile,
        readWikilinksFromFile,
        setCurrentGraph,
        setupDeleteFilesystemTest,
        setupMergeFilesystemTest,
        tempVault,
        vaultFilePath,
        writeMarkdownFile
    }
}
