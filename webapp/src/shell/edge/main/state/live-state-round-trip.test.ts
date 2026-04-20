/**
 * L4-BF-197 — Round-trip: getCurrentLiveState reflects all 15 Command variants.
 *
 * CASES is typed Record<Command['type'], TestCase> so adding a new Command
 * variant to contract.d.ts without adding a row here breaks the build.
 */
import { promises as fsp } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Command, State } from '@vt/graph-state'
import type { Graph } from '@vt/graph-model/pure/graph'

vi.mock('@vt/graph-model', async () => {
    const actual: Record<string, unknown> = await vi.importActual('@vt/graph-model')
    return {
        ...actual,
        getGraph: vi.fn(),
        getProjectRootWatchedDirectory: vi.fn(() => null),
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

vi.mock('@/shell/edge/main/state/renderer-live-state-proxy', () => ({
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
            case 'Collapse':
                if (typeof command.folder === 'string') {
                    rendererCollapseSet = new Set([...rendererCollapseSet, command.folder])
                }
                break
            case 'Expand':
                if (typeof command.folder === 'string') {
                    rendererCollapseSet = new Set(
                        [...rendererCollapseSet].filter((folder) => folder !== command.folder),
                    )
                }
                break
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
        command.type === 'Collapse'
        || command.type === 'Expand'
        || command.type === 'Select'
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
} from '@/shell/edge/main/state/live-state-store'
import { applyRendererLiveCommand } from '@/shell/edge/main/state/renderer-live-state-proxy'

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
    await fsp.mkdir(TMP_ROOT, { recursive: true })
    await fsp.writeFile(path.join(TMP_ROOT, 'note.md'), '# note\n', 'utf8')
})

afterAll(async () => {
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

describe('L4-BF-197 — getCurrentLiveState round-trip for all 15 Command variants', () => {
    const nodeId: string = `${TMP_ROOT}/note.md`
    const otherId: string = `${TMP_ROOT}/other.md`
    const folder: string = `${TMP_ROOT}/subdir/`

    const CASES: Record<Command['type'], TestCase> = {
        Collapse: {
            cmd: { type: 'Collapse', folder },
            check: (s) => expect(s.collapseSet.has(folder)).toBe(true),
        },
        Expand: {
            setup: async () => { await applyLiveCommandAsync({ type: 'Collapse', folder }) },
            cmd: { type: 'Expand', folder },
            check: (s) => expect(s.collapseSet.has(folder)).toBe(false),
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
        LoadRoot: {
            cmd: { type: 'LoadRoot', root: TMP_ROOT },
            check: (s) => expect(s.roots.loaded.has(TMP_ROOT)).toBe(true),
        },
        UnloadRoot: {
            setup: async () => { await applyLiveCommandAsync({ type: 'LoadRoot', root: TMP_ROOT }) },
            cmd: { type: 'UnloadRoot', root: TMP_ROOT },
            check: (s) => expect(s.roots.loaded.has(TMP_ROOT)).toBe(false),
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

    it('covers exactly 15 Command variants (compile-time + runtime guard)', () => {
        expect(Object.keys(CASES)).toHaveLength(15)
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
