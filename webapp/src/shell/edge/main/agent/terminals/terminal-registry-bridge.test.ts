/**
 * Behavioural test for the terminal-registry cache mirror + SSE
 * subscriber. Drives the full path: spin up a fake hub HTTP server that
 * speaks the SSE wire protocol, point the subscriber at it via the
 * existing `daemon-url-binding` accessors (stubbed), dispatch each of
 * the five `TerminalRegistryEvent` shapes, and assert the local cache
 * mirrors the registry-mutation events while passing UI-instruction
 * envelopes through `applyTerminalRegistryEnvelope`'s outcome.
 *
 * No spies. The cache is read via `getCachedTerminalRecords`; the
 * applied outcome is read by collecting the values the subscriber
 * forwarded to the bridge.
 */

import {createServer, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import type {Option} from 'fp-ts/lib/Option.js'
import * as O from 'fp-ts/lib/Option.js'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import type {
    NodeIdAndFilePath,
} from '@vt/graph-model/graph'
import type {
    TerminalData,
    TerminalId,
    TerminalRecord,
    TerminalRegistryEvent,
} from '@vt/vt-daemon-client'

import {
    applyTerminalRegistryEnvelope,
    getCachedTerminalRecord,
    getCachedTerminalRecords,
    resetTerminalRegistryCache,
    type TerminalRegistryEnvelopeOutcome,
} from './terminal-registry-bridge'
import {
    subscribeToTerminalRegistrySse,
    unsubscribeFromTerminalRegistrySse,
    type TerminalRegistryEnvelope,
} from '@/shell/edge/main/runtime/electron/daemon/sync/terminal-registry-sse-subscription'

const ACTIVE_PROJECT: string = '/the/active/project'

vi.mock('@/shell/edge/main/runtime/electron/daemon/daemon-url-binding', () => ({
    getDaemonUrl: vi.fn(async (): Promise<string> => fakeHubUrl()),
    getAuthToken: vi.fn(async (): Promise<string> => 'test-token'),
    getActiveProject: vi.fn((): string | null => ACTIVE_PROJECT),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecord(id: string, overrides: Partial<TerminalRecord> = {}): TerminalRecord {
    return {
        terminalId: id,
        status: 'running',
        exitCode: null,
        exitSignal: null,
        killReason: null,
        auditRetryCount: 0,
        spawnedAt: 1700000000000,
        terminalData: makeTerminalData(id),
        ...overrides,
    }
}

function makeTerminalData(id: string): TerminalData {
    const noneOption: Option<NodeIdAndFilePath> = O.none
    return {
        type: 'Terminal',
        terminalId: id as TerminalId,
        attachedToContextNodeId: '/some/context.md' as NodeIdAndFilePath,
        terminalCount: 1,
        anchoredToNodeId: noneOption,
        title: `Terminal ${id}`,
        resizable: true,
        shadowNodeDimensions: {width: 320, height: 200},
        isPinned: false,
        isDone: false,
        lifecycle: 'spawning',
        statusPhrase: '',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        agentName: 'agent-' + id,
        worktreeName: undefined,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: 'plain',
    }
}

// ---------------------------------------------------------------------------
// Pure bridge unit tests — no SSE
// ---------------------------------------------------------------------------

describe('applyTerminalRegistryEnvelope — pure cache application', (): void => {
    beforeEach((): void => {
        resetTerminalRegistryCache()
    })

    it('terminal-registered inserts the row into the cache', (): void => {
        const record: TerminalRecord = makeRecord('T1')
        const event: TerminalRegistryEvent = {type: 'terminal-registered', record}
        const outcome: TerminalRegistryEnvelopeOutcome = applyTerminalRegistryEnvelope({
            kind: 'terminal-registry', seq: 1, event, project: ACTIVE_PROJECT,
        })
        expect(outcome.kind).toBe('cache-mutated')
        expect(getCachedTerminalRecords()).toHaveLength(1)
        expect(getCachedTerminalRecord('T1' as TerminalId)).toEqual(record)
    })

    it('terminal-record-changed patches isPinned on an existing row', (): void => {
        const record: TerminalRecord = makeRecord('T1')
        applyTerminalRegistryEnvelope({
            kind: 'terminal-registry', seq: 1, project: ACTIVE_PROJECT,
            event: {type: 'terminal-registered', record},
        })
        const outcome: TerminalRegistryEnvelopeOutcome = applyTerminalRegistryEnvelope({
            kind: 'terminal-registry', seq: 2, project: ACTIVE_PROJECT,
            event: {
                type: 'terminal-record-changed',
                terminalId: 'T1' as TerminalId,
                patch: {kind: 'pinned', value: true},
            },
        })
        expect(outcome.kind).toBe('cache-mutated')
        const cached: TerminalRecord | null = getCachedTerminalRecord('T1' as TerminalId)
        expect(cached?.terminalData.isPinned).toBe(true)
    })

    it('terminal-record-changed lifecycle patch updates the daemon-authoritative lifecycle', (): void => {
        // Regression: a freshly-registered row carries lifecycle 'spawning'.
        // Without applying lifecycle patches the sidebar icon stays frozen on
        // the grey 'spawning' dot for every terminal regardless of true state.
        applyTerminalRegistryEnvelope({
            kind: 'terminal-registry', seq: 1, project: ACTIVE_PROJECT,
            event: {type: 'terminal-registered', record: makeRecord('T1')},
        })
        expect(getCachedTerminalRecord('T1' as TerminalId)?.terminalData.lifecycle).toBe('spawning')

        applyTerminalRegistryEnvelope({
            kind: 'terminal-registry', seq: 2, project: ACTIVE_PROJECT,
            event: {
                type: 'terminal-record-changed',
                terminalId: 'T1' as TerminalId,
                patch: {kind: 'lifecycle', value: 'awaiting_input'},
            },
        })
        expect(getCachedTerminalRecord('T1' as TerminalId)?.terminalData.lifecycle).toBe('awaiting_input')
    })

    it('terminal-record-changed activity patch merges lastOutputTime + activityCount', (): void => {
        applyTerminalRegistryEnvelope({
            kind: 'terminal-registry', seq: 1, project: ACTIVE_PROJECT,
            event: {type: 'terminal-registered', record: makeRecord('T1')},
        })
        applyTerminalRegistryEnvelope({
            kind: 'terminal-registry', seq: 2, project: ACTIVE_PROJECT,
            event: {
                type: 'terminal-record-changed',
                terminalId: 'T1' as TerminalId,
                patch: {kind: 'activity', value: {lastOutputTime: 42, activityCount: 7}},
            },
        })
        const cached: TerminalRecord | null = getCachedTerminalRecord('T1' as TerminalId)
        expect(cached?.terminalData.lastOutputTime).toBe(42)
        expect(cached?.terminalData.activityCount).toBe(7)
    })

    it('terminal-removed deletes the row', (): void => {
        applyTerminalRegistryEnvelope({
            kind: 'terminal-registry', seq: 1, project: ACTIVE_PROJECT,
            event: {type: 'terminal-registered', record: makeRecord('T1')},
        })
        const outcome: TerminalRegistryEnvelopeOutcome = applyTerminalRegistryEnvelope({
            kind: 'terminal-registry', seq: 2, project: ACTIVE_PROJECT,
            event: {type: 'terminal-removed', terminalId: 'T1' as TerminalId},
        })
        expect(outcome.kind).toBe('cache-mutated')
        expect(getCachedTerminalRecord('T1' as TerminalId)).toBeNull()
    })

    it('terminal-record-changed against an unknown id is dropped without crash', (): void => {
        const outcome: TerminalRegistryEnvelopeOutcome = applyTerminalRegistryEnvelope({
            kind: 'terminal-registry', seq: 1, project: ACTIVE_PROJECT,
            event: {
                type: 'terminal-record-changed',
                terminalId: 'unknown' as TerminalId,
                patch: {kind: 'done', value: true},
            },
        })
        expect(outcome.kind).toBe('dropped')
        expect(getCachedTerminalRecords()).toHaveLength(0)
    })

    it('terminal-ui-launch is forwarded as ui-instruction without touching the cache', (): void => {
        const outcome: TerminalRegistryEnvelopeOutcome = applyTerminalRegistryEnvelope({
            kind: 'terminal-registry', seq: 1, project: ACTIVE_PROJECT,
            event: {
                type: 'terminal-ui-launch',
                nodeId: '/a/b.md' as NodeIdAndFilePath,
                terminalData: makeTerminalData('T1'),
                skipFitAnimation: false,
            },
        })
        expect(outcome.kind).toBe('ui-instruction')
        expect(getCachedTerminalRecords()).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// End-to-end: SSE subscriber + bridge over a real loopback fake hub
// ---------------------------------------------------------------------------

let hub: Server | null = null
let hubUrl: string = ''

function fakeHubUrl(): string {
    if (hubUrl === '') throw new Error('fake hub not started yet')
    return hubUrl
}

async function startFakeHubEmitting(blocks: readonly string[]): Promise<void> {
    hub = createServer((req, res): void => {
        if (req.method !== 'GET' || !req.url?.startsWith('/sessions/')) {
            res.writeHead(404); res.end(); return
        }
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        })
        for (const block of blocks) res.write(block)
        // Leave the response open — the subscriber's silence timeout
        // would close it eventually. For tests we close after a short
        // delay so the subscriber doesn't keep the test alive.
        setTimeout((): void => { res.end() }, 50)
    })
    await new Promise<void>((resolve) => hub!.listen(0, '127.0.0.1', resolve))
    const port: number = (hub.address() as AddressInfo).port
    hubUrl = `http://127.0.0.1:${port}`
}

async function stopFakeHub(): Promise<void> {
    if (hub === null) return
    await new Promise<void>((resolve) => hub!.close(() => resolve()))
    hub = null
    hubUrl = ''
}

function encodeBlock(envelope: TerminalRegistryEnvelope): string {
    return `data: ${JSON.stringify(envelope)}\n\n`
}

describe('subscribeToTerminalRegistrySse → bridge — wire behaviour', (): void => {
    beforeEach((): void => {
        process.env.NODE_ENV = 'test'
        resetTerminalRegistryCache()
    })
    afterEach(async (): Promise<void> => {
        unsubscribeFromTerminalRegistrySse()
        await stopFakeHub()
        vi.useRealTimers()
    })

    it('mirrors a register → patch → remove sequence into the local cache', async (): Promise<void> => {
        const record: TerminalRecord = makeRecord('T1')
        const register: TerminalRegistryEnvelope = {
            kind: 'terminal-registry', seq: 1, project: ACTIVE_PROJECT,
            event: {type: 'terminal-registered', record},
        }
        const patch: TerminalRegistryEnvelope = {
            kind: 'terminal-registry', seq: 2, project: ACTIVE_PROJECT,
            event: {
                type: 'terminal-record-changed',
                terminalId: 'T1' as TerminalId,
                patch: {kind: 'done', value: true},
            },
        }
        const remove: TerminalRegistryEnvelope = {
            kind: 'terminal-registry', seq: 3, project: ACTIVE_PROJECT,
            event: {type: 'terminal-removed', terminalId: 'T1' as TerminalId},
        }

        await startFakeHubEmitting([encodeBlock(register), encodeBlock(patch), encodeBlock(remove)])

        const outcomes: TerminalRegistryEnvelopeOutcome[] = []
        subscribeToTerminalRegistrySse('main-1', (envelope: TerminalRegistryEnvelope): void => {
            outcomes.push(applyTerminalRegistryEnvelope(envelope))
        })

        await vi.waitFor((): void => {
            expect(outcomes).toHaveLength(3)
        }, {timeout: 3_000})

        expect(outcomes.map((o) => o.kind)).toEqual(['cache-mutated', 'cache-mutated', 'cache-mutated'])
        // After the remove the cache should be empty.
        expect(getCachedTerminalRecords()).toHaveLength(0)
    }, 5_000)

    it('drops envelopes whose project does not match getActiveProject()', async (): Promise<void> => {
        const recordOurs: TerminalRecord = makeRecord('OURS')
        const recordTheirs: TerminalRecord = makeRecord('THEIRS')
        await startFakeHubEmitting([
            encodeBlock({
                kind: 'terminal-registry', seq: 1, project: '/some/other/project',
                event: {type: 'terminal-registered', record: recordTheirs},
            }),
            encodeBlock({
                kind: 'terminal-registry', seq: 2, project: ACTIVE_PROJECT,
                event: {type: 'terminal-registered', record: recordOurs},
            }),
        ])

        const outcomes: TerminalRegistryEnvelopeOutcome[] = []
        subscribeToTerminalRegistrySse('main-1', (envelope: TerminalRegistryEnvelope): void => {
            outcomes.push(applyTerminalRegistryEnvelope(envelope))
        })

        await vi.waitFor((): void => {
            expect(outcomes).toHaveLength(1)
        }, {timeout: 3_000})

        expect(getCachedTerminalRecord('OURS' as TerminalId)).not.toBeNull()
        expect(getCachedTerminalRecord('THEIRS' as TerminalId)).toBeNull()
    }, 5_000)
})
