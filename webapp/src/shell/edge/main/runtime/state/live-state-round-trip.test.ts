/**
 * L4-BF-197 — Round-trip: getCurrentLiveState reflects supported Command variants.
 *
 * CASES is typed Record<Command['type'], TestCase> so adding a new Command
 * variant to contract.d.ts without adding a row here breaks the build.
 */
import { promises as fsp } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import { clearRootIOForTests, configureRootIO, type Command, type State } from '@vt/graph-state'
import type { DirectoryEntry, Graph } from '@vt/graph-model/graph'

vi.mock('@vt/graph-model', async () => {
    const actual: Record<string, unknown> = await vi.importActual('@vt/graph-model')
    return {
        ...actual,
        getGraph: vi.fn(),
        getProjectRoot: vi.fn(async () => null),
        getVaultPaths: vi.fn(async () => []),
        getReadPaths: vi.fn(async () => []),
    }
})

let rendererCollapseSet: Set<string> = new Set()
let rendererSelection: Set<string> = new Set()

function resetRendererState(): void {
    rendererCollapseSet = new Set()
    rendererSelection = new Set()
}

vi.mock('@/shell/edge/main/runtime/state/renderer-live-state-proxy', () => ({
    readRendererLiveState: vi.fn(async () => ({
        collapseSet: new Set(rendererCollapseSet),
        selection: new Set(rendererSelection),
    })),
    applyRendererLiveCommand: vi.fn(async (command: {
        type: string
        folder?: string
        ids?: readonly string[]
        additive?: boolean
    }) => {
        switch (command.type) {
            case 'Select': {
                const next: Set<string> =
                    command.additive === true ? new Set(rendererSelection) : new Set()
                for (const id of command.ids ?? []) {
                    next.add(id)
                }
                rendererSelection = next
                break
            }
            case 'Deselect': {
                const next: Set<string> = new Set(rendererSelection)
                for (const id of command.ids ?? []) {
                    next.delete(id)
                }
                rendererSelection = next
                break
            }
            default:
                break
        }
        return {
            collapseSet: new Set(rendererCollapseSet),
            selection: new Set(rendererSelection),
        }
    }),
    isRendererOwnedLiveCommand: (command: { type: string }): boolean =>
        command.type === 'Select'
        || command.type === 'Deselect'
        || command.type === 'SetZoom'
        || command.type === 'SetPan'
        || command.type === 'RequestFit',
}))

import { getGraph } from '@vt/graph-model'
import {
    applyLiveCommandAsync,
    getCurrentLiveState,
    __resetLiveStoreForTests,
} from '@/shell/edge/main/runtime/state/live-state-store'
import { applyRendererLiveCommand } from '@/shell/edge/main/runtime/state/renderer-live-state-proxy'

function emptyGraph(): Graph {
    return {
        nodes: {},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

const TMP_ROOT: string = path.join(tmpdir(), `bf197-round-trip-${process.pid}`)

beforeAll(async () => {
    configureRootIO({
        getDirectoryTree: async (rootPath: string): Promise<DirectoryEntry> => ({
            absolutePath: rootPath,
            name: path.basename(rootPath),
            isDirectory: true,
            children: [],
        }),
        loadGraphFromDisk: async () => E.right(emptyGraph()),
    })
    await fsp.mkdir(TMP_ROOT, { recursive: true })
    await fsp.writeFile(path.join(TMP_ROOT, 'note.md'), '# note\n', 'utf8')
})

afterAll(async () => {
    clearRootIOForTests()
    await fsp.rm(TMP_ROOT, { recursive: true, force: true })
})

beforeEach(() => {
    __resetLiveStoreForTests()
    resetRendererState()
    vi.clearAllMocks()
    vi.mocked(getGraph).mockReturnValue(emptyGraph())
})

type TestCase = {
    setup?: () => Promise<void>
    cmd: Command
    check: (s: State) => void
}

describe('L4-BF-197 — getCurrentLiveState round-trip for supported Command variants', () => {
    const nodeId: string = `${TMP_ROOT}/note.md`
    const otherId: string = `${TMP_ROOT}/other.md`
    const folder: string = `${TMP_ROOT}/subdir/`

    const CASES: Record<Command['type'], TestCase> = {
        SetFolderState: {
            cmd: {
                type: 'SetFolderState',
                viewId: 'main',
                path: folder.slice(0, -1),
                state: 'collapsed',
            },
            check: (s) => expect(s.meta.revision).toBeGreaterThanOrEqual(1),
        },
        Select: {
            cmd: { type: 'Select', ids: [nodeId] },
            check: (s) => expect(s.selection.has(nodeId)).toBe(true),
        },
        Deselect: {
            setup: async () => { await applyLiveCommandAsync({ type: 'Select', ids: [nodeId] }) },
            cmd: { type: 'Deselect', ids: [nodeId] },
            check: (s) => expect(s.selection.has(nodeId)).toBe(false),
        },
        AddNode: {
            cmd: {
                type: 'AddNode',
                node: {
                    absoluteFilePathIsID: nodeId,
                    outgoingEdges: [],
                    contentWithoutYamlOrLinks: '',
                    nodeUIMetadata: {
                        color: O.none,
                        position: O.none,
                        additionalYAMLProps: new Map(),
                        isContextNode: false,
                    },
                },
            },
            check: (s) => expect(s.meta.revision).toBeGreaterThanOrEqual(1),
        },
        RemoveNode: {
            cmd: { type: 'RemoveNode', id: nodeId },
            check: (s) => expect(s.meta.revision).toBeGreaterThanOrEqual(1),
        },
        AddEdge: {
            cmd: { type: 'AddEdge', source: nodeId, edge: { targetId: otherId, label: 'link' } },
            check: (s) => expect(s.meta.revision).toBeGreaterThanOrEqual(1),
        },
        RemoveEdge: {
            cmd: { type: 'RemoveEdge', source: nodeId, targetId: otherId },
            check: (s) => expect(s.meta.revision).toBeGreaterThanOrEqual(1),
        },
        Move: {
            cmd: { type: 'Move', id: nodeId, to: { x: 10, y: 20 } },
            check: (s) => expect(s.meta.revision).toBeGreaterThanOrEqual(1),
        },
        SetZoom: {
            cmd: { type: 'SetZoom', zoom: 2.0 },
            check: (s) => expect(s.layout.zoom).toBe(2.0),
        },
        SetPan: {
            cmd: { type: 'SetPan', pan: { x: 100, y: 50 } },
            check: (s) => expect(s.layout.pan).toEqual({ x: 100, y: 50 }),
        },
        SetPositions: {
            cmd: { type: 'SetPositions', positions: new Map([[nodeId, { x: 7, y: 9 }]]) },
            check: (s) => expect(s.layout.positions.get(nodeId)).toEqual({ x: 7, y: 9 }),
        },
        RequestFit: {
            cmd: { type: 'RequestFit', paddingPx: 20 },
            check: (s) => expect(s.layout.fit?.paddingPx).toBe(20),
        },
    }

    it('covers exactly 12 Command variants (compile-time + runtime guard)', () => {
        expect(Object.keys(CASES)).toHaveLength(12)
    })

    for (const [type, testCase] of Object.entries(CASES) as Array<[Command['type'], TestCase]>) {
        it(`${type}: getCurrentLiveState reflects the command`, async () => {
            if (testCase.setup) await testCase.setup()
            await applyLiveCommandAsync(testCase.cmd)
            testCase.check(await getCurrentLiveState())
        })
    }

    it('forwards viewport commands to the renderer live-state proxy', async () => {
        await applyLiveCommandAsync({ type: 'SetZoom', zoom: 2.0 })
        await applyLiveCommandAsync({ type: 'SetPan', pan: { x: 100, y: 50 } })
        await applyLiveCommandAsync({ type: 'RequestFit', paddingPx: 20 })

        expect(vi.mocked(applyRendererLiveCommand)).toHaveBeenNthCalledWith(1, {
            type: 'SetZoom',
            zoom: 2.0,
        })
        expect(vi.mocked(applyRendererLiveCommand)).toHaveBeenNthCalledWith(2, {
            type: 'SetPan',
            pan: { x: 100, y: 50 },
        })
        expect(vi.mocked(applyRendererLiveCommand)).toHaveBeenNthCalledWith(3, {
            type: 'RequestFit',
            paddingPx: 20,
        })
    })
})
