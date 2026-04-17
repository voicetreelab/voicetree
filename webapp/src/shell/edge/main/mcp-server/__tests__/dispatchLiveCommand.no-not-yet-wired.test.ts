/**
 * L3-BF-186 — regression gate: every Command discriminator must dispatch
 * through `dispatchLiveCommand` without returning the `not-yet-wired` sentinel.
 *
 * The `MINIMAL_EXAMPLES` map is typed `Record<Command['type'], SerializedCommand>`,
 * so adding a new variant to the `Command` type union in
 * `packages/graph-state/src/contract.d.ts` without adding a row here fails at
 * compile time. Runtime iteration over `Object.keys(MINIMAL_EXAMPLES)` is thus
 * exhaustive by construction.
 *
 * If a future variant legitimately cannot be round-tripped through live-MCP
 * dispatch (e.g. Delta shape not finalized), add it to `EXPLICIT_SKIPS` with a
 * loud comment explaining why — do NOT remove the compile-time constraint.
 */
import { promises as fsp } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import type { Command, SerializedCommand } from '@vt/graph-state'
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
import { dispatchLiveCommand } from '@/shell/edge/main/mcp-server/dispatchLiveCommandTool'
import { __resetLiveStoreForTests } from '@/shell/edge/main/state/live-state-store'

function emptyGraph(): Graph {
    return {
        nodes: {},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

const TMP_ROOT: string = path.join(tmpdir(), `bf186-wired-variants-${process.pid}`)

function buildMinimalExamples(root: string): Record<Command['type'], SerializedCommand> {
    const folder: string = `${root}/subdir/`
    const nodeId: string = `${root}/note.md`
    const otherId: string = `${root}/other.md`
    return {
        Collapse:     { type: 'Collapse',    folder },
        Expand:       { type: 'Expand',      folder },
        Select:       { type: 'Select',      ids: [nodeId] },
        Deselect:     { type: 'Deselect',    ids: [nodeId] },
        AddNode:      {
            type: 'AddNode',
            node: {
                outgoingEdges: [],
                absoluteFilePathIsID: nodeId,
                contentWithoutYamlOrLinks: 'seed',
                nodeUIMetadata: {
                    color: { _tag: 'None' },
                    position: { _tag: 'None' },
                    additionalYAMLProps: [],
                },
            },
        },
        RemoveNode:   { type: 'RemoveNode',  id: nodeId },
        AddEdge:      { type: 'AddEdge',     source: nodeId, edge: { targetId: otherId, label: 'leads-to' } },
        RemoveEdge:   { type: 'RemoveEdge',  source: nodeId, targetId: otherId },
        Move:         { type: 'Move',        id: nodeId, to: { x: 10, y: 20 } },
        LoadRoot:     { type: 'LoadRoot',    root },
        UnloadRoot:   { type: 'UnloadRoot',  root },
        SetZoom:      { type: 'SetZoom',     zoom: 1.5 },
        SetPan:       { type: 'SetPan',      pan: { x: 100, y: 50 } },
        SetPositions: { type: 'SetPositions', positions: [[nodeId, { x: 7, y: 9 }]] },
        RequestFit:   { type: 'RequestFit',  paddingPx: 20 },
    }
}

/**
 * Explicitly skipped command types. MUST be empty — any non-empty entry means
 * a regression. Keep the constant for future loud-skip documentation only.
 */
const EXPLICIT_SKIPS: ReadonlySet<Command['type']> = new Set<Command['type']>()

beforeAll(async () => {
    await fsp.mkdir(TMP_ROOT, { recursive: true })
    await fsp.writeFile(path.join(TMP_ROOT, 'note.md'), '# note\n', 'utf8')
})

afterAll(async () => {
    await fsp.rm(TMP_ROOT, { recursive: true, force: true })
})

beforeEach(() => {
    __resetLiveStoreForTests()
    vi.mocked(getGraph).mockReturnValue(emptyGraph())
})

describe('L3-BF-186 — no Command variant returns not-yet-wired', () => {
    it('EXPLICIT_SKIPS is empty (loud guard)', () => {
        expect([...EXPLICIT_SKIPS]).toEqual([])
    })

    it('every Command variant dispatches without a not-yet-wired sentinel', async () => {
        const examples: Record<Command['type'], SerializedCommand> = buildMinimalExamples(TMP_ROOT)
        const types: Command['type'][] = Object.keys(examples) as Command['type'][]

        // Completeness guard — any drop from the set compared to a hard-coded
        // count would miss a silent regression. 15 matches Command union size
        // (contract.d.ts). If the union grows, compile fails at the Record type
        // above AND at this assertion.
        expect(types).toHaveLength(15)

        const offenders: Array<{ readonly type: Command['type']; readonly response: unknown }> = []
        for (const type of types) {
            if (EXPLICIT_SKIPS.has(type)) continue
            const response: Awaited<ReturnType<typeof dispatchLiveCommand>> = await dispatchLiveCommand({
                command: examples[type],
            })
            const blob: string = JSON.stringify(response)
            if (blob.includes('not-yet-wired')) {
                offenders.push({ type, response })
            }
        }

        expect(offenders).toEqual([])
    })

    it('every Command variant bumps the returned revision', async () => {
        const examples: Record<Command['type'], SerializedCommand> = buildMinimalExamples(TMP_ROOT)
        const results: Record<string, number> = {}
        for (const [type, cmd] of Object.entries(examples) as Array<[Command['type'], SerializedCommand]>) {
            if (EXPLICIT_SKIPS.has(type)) continue
            __resetLiveStoreForTests()
            vi.mocked(getGraph).mockReturnValue(emptyGraph())
            const resp: Awaited<ReturnType<typeof dispatchLiveCommand>> = await dispatchLiveCommand({
                command: cmd,
            })
            results[type] = resp.revision
        }
        for (const [type, revision] of Object.entries(results)) {
            expect(revision, `${type} must bump revision to 1`).toBeGreaterThanOrEqual(1)
        }
    })
})
