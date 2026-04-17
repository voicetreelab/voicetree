import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Graph } from '@vt/graph-model/pure/graph'

vi.mock('@vt/graph-model', async () => {
    const actual: Record<string, unknown> = await vi.importActual('@vt/graph-model')
    return {
        ...actual,
        getGraph: vi.fn(),
    }
})

vi.mock('@/shell/edge/main/ui-api-proxy', () => ({
    uiAPI: new Proxy({} as Record<string, unknown>, {
        get: () => (): void => { /* no-op in tests */ },
    }),
}))

import { getGraph } from '@vt/graph-model'
import {
    dispatchLiveCommand,
    dispatchLiveCommandTool,
} from '@/shell/edge/main/mcp-server/dispatchLiveCommandTool'
import {
    getCurrentLiveState,
    __resetLiveStoreForTests,
} from '@/shell/edge/main/state/live-state-store'

function emptyGraph(): Graph {
    return {
        nodes: {},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

beforeEach(() => {
    __resetLiveStoreForTests()
    vi.mocked(getGraph).mockReturnValue(emptyGraph())
})

describe('vt_dispatch_live_command', () => {
    it('Collapse adds the folder to collapseSet and bumps revision', async () => {
        const result: Awaited<ReturnType<typeof dispatchLiveCommand>> = await dispatchLiveCommand({
            command: { type: 'Collapse', folder: '/tmp/vault/tasks/' },
        })

        expect(result.revision).toBe(1)
        expect(result.delta.collapseAdded).toEqual(['/tmp/vault/tasks/'])
        const state: ReturnType<typeof getCurrentLiveState> = getCurrentLiveState()
        expect([...state.collapseSet]).toContain('/tmp/vault/tasks/')
        expect(state.meta.revision).toBe(1)
    })

    it('Expand removes the folder and emits collapseRemoved', async () => {
        await dispatchLiveCommand({ command: { type: 'Collapse', folder: '/tmp/vault/tasks/' } })
        const result: Awaited<ReturnType<typeof dispatchLiveCommand>> = await dispatchLiveCommand({
            command: { type: 'Expand', folder: '/tmp/vault/tasks/' },
        })

        expect(result.delta.collapseRemoved).toEqual(['/tmp/vault/tasks/'])
        expect([...getCurrentLiveState().collapseSet]).not.toContain('/tmp/vault/tasks/')
    })

    it('Select (replace) sets selection and reports previous ids as removed', async () => {
        await dispatchLiveCommand({ command: { type: 'Select', ids: ['a'] } })
        const result: Awaited<ReturnType<typeof dispatchLiveCommand>> = await dispatchLiveCommand({
            command: { type: 'Select', ids: ['b', 'c'] },
        })

        expect([...getCurrentLiveState().selection].sort()).toEqual(['b', 'c'])
        expect(result.delta.selectionAdded).toEqual(['b', 'c'])
        expect(result.delta.selectionRemoved).toEqual(['a'])
    })

    it('Select (additive) merges ids without removing prior selection', async () => {
        await dispatchLiveCommand({ command: { type: 'Select', ids: ['a'] } })
        const result: Awaited<ReturnType<typeof dispatchLiveCommand>> = await dispatchLiveCommand({
            command: { type: 'Select', ids: ['b'], additive: true },
        })

        expect([...getCurrentLiveState().selection].sort()).toEqual(['a', 'b'])
        expect(result.delta.selectionAdded).toEqual(['b'])
        expect(result.delta.selectionRemoved).toBeUndefined()
    })

    it('Deselect removes only the listed ids', async () => {
        await dispatchLiveCommand({ command: { type: 'Select', ids: ['a', 'b', 'c'] } })
        const result: Awaited<ReturnType<typeof dispatchLiveCommand>> = await dispatchLiveCommand({
            command: { type: 'Deselect', ids: ['b'] },
        })

        expect([...getCurrentLiveState().selection].sort()).toEqual(['a', 'c'])
        expect(result.delta.selectionRemoved).toEqual(['b'])
    })

    it('Move bumps revision and returns a delta without a not-yet-wired sentinel (L3-BF-186)', async () => {
        const before: number = getCurrentLiveState().meta.revision
        const result: Awaited<ReturnType<typeof dispatchLiveCommand>> = await dispatchLiveCommand({
            command: { type: 'Move', id: 'x', to: { x: 1, y: 2 } },
        })

        expect(JSON.stringify(result)).not.toContain('not-yet-wired')
        expect(result.revision).toBe(before + 1)
    })

    it('dispatchLiveCommandTool wraps the payload in an MCP response', async () => {
        const resp: Awaited<ReturnType<typeof dispatchLiveCommandTool>> =
            await dispatchLiveCommandTool({
                command: { type: 'Collapse', folder: '/tmp/vault/x/' },
            })

        expect(resp.isError).not.toBe(true)
        const payload: Record<string, unknown> = JSON.parse(resp.content[0].text)
        expect(payload.revision).toBe(1)
        const delta: { collapseAdded?: readonly string[] } =
            payload.delta as { collapseAdded?: readonly string[] }
        expect(delta.collapseAdded).toEqual(['/tmp/vault/x/'])
    })

    it('dispatch → getCurrentLiveState round-trip: Collapse lands in collapseSet (spec verification)', async () => {
        const folder: string = '/Users/bobbobby/repos/voicetree-public/brain/working-memory/tasks/'
        await dispatchLiveCommand({ command: { type: 'Collapse', folder } })
        const roundTrip: ReturnType<typeof getCurrentLiveState> = getCurrentLiveState()
        expect([...roundTrip.collapseSet]).toContain(folder)
    })
})
