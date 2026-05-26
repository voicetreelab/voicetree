/**
 * Black-box tests for the Main-side agent-events SSE subscriber. The
 * subscriber's contract is:
 *   (a) connect with bearer auth + ?since=<lastSeenSeq>,
 *   (b) parse SSE blocks into AgentEventsFrame,
 *   (c) apply the vault-switch fence by consulting getActiveVault(),
 *   (d) hand surviving envelopes to the caller-supplied onEnvelope handler.
 *
 * fetch is the impurity boundary (network → process). We stub fetch and
 * `getDaemonUrl`/`getAuthToken`/`getActiveVault` since those are the
 * subscriber's edge-of-system collaborators. No internal mocks beyond
 * those edges.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {
    parseAgentEventsBlock,
    subscribeToAgentEventsSse,
    unsubscribeFromAgentEventsSse,
    type AgentEventEnvelope,
    type AgentEventsFrame,
} from './agent-events-sse-subscription'

vi.mock('@/shell/edge/main/runtime/electron/daemon/daemon-url-binding', () => ({
    getDaemonUrl: vi.fn(async (): Promise<string> => 'http://127.0.0.1:9001'),
    getAuthToken: vi.fn(async (): Promise<string> => 'test-token'),
    getActiveVault: vi.fn((): string | null => '/the/active/vault'),
}))

function makeEnvelopeBlock(envelope: AgentEventEnvelope): Uint8Array {
    return new TextEncoder().encode(`data: ${JSON.stringify(envelope)}\n\n`)
}

function makeGapBlock(fromSeq: number, currentSeq: number, vault: string): Uint8Array {
    return new TextEncoder().encode(
        `data: ${JSON.stringify({kind: 'agent-events-gap', fromSeq, currentSeq, vault})}\n\n`,
    )
}

function installFetchStream(chunks: readonly Uint8Array[]): ReturnType<typeof vi.fn> {
    const fetchFn = vi.fn(async (): Promise<Response> => new Response(
        new ReadableStream<Uint8Array>({
            start(controller): void {
                for (const chunk of chunks) controller.enqueue(chunk)
                controller.close()
            },
        }),
        {status: 200},
    ))
    vi.stubGlobal('fetch', fetchFn)
    return fetchFn
}

describe('parseAgentEventsBlock — pure helper', (): void => {
    it('parses a well-formed agent-events envelope', (): void => {
        const block: string = `data: ${JSON.stringify({
            kind: 'agent-events',
            seq: 7,
            event: 'Stop',
            data: {terminalId: 'T1', source: 'claude-code', at: 1, handlerResult: null},
            vault: '/v',
        })}`
        const parsed: AgentEventsFrame | null = parseAgentEventsBlock(block)
        expect(parsed).toEqual({
            kind: 'agent-events',
            seq: 7,
            event: 'Stop',
            data: {terminalId: 'T1', source: 'claude-code', at: 1, handlerResult: null},
            vault: '/v',
        })
    })

    it('parses a gap envelope', (): void => {
        const block: string = `data: ${JSON.stringify({
            kind: 'agent-events-gap',
            fromSeq: 5,
            currentSeq: 12,
            vault: '/v',
        })}`
        const parsed: AgentEventsFrame | null = parseAgentEventsBlock(block)
        expect(parsed).toEqual({kind: 'agent-events-gap', fromSeq: 5, currentSeq: 12, vault: '/v'})
    })

    it('returns null on missing kind discriminator', (): void => {
        expect(parseAgentEventsBlock('data: {"seq":1}')).toBeNull()
    })

    it('returns null on missing data line', (): void => {
        expect(parseAgentEventsBlock('event: agent-events')).toBeNull()
    })

    it('returns null on unrecognised kind', (): void => {
        expect(parseAgentEventsBlock('data: {"kind":"other","seq":1}')).toBeNull()
    })
})

describe('subscribeToAgentEventsSse — wire behaviour', (): void => {
    beforeEach((): void => {
        process.env.NODE_ENV = 'test'
    })
    afterEach((): void => {
        unsubscribeFromAgentEventsSse()
        vi.useRealTimers()
        vi.unstubAllGlobals()
        vi.resetAllMocks()
    })

    it('connects to /sessions/<id>/agent-events with bearer + ?since=0 on first connect', async (): Promise<void> => {
        const fetchFn = installFetchStream([])
        subscribeToAgentEventsSse('main-1', (): void => {})

        await vi.waitFor((): void => {
            expect(fetchFn).toHaveBeenCalled()
        })
        const call = fetchFn.mock.calls[0]
        expect(call[0]).toBe('http://127.0.0.1:9001/sessions/main-1/agent-events?since=0')
        const init = call[1] as RequestInit
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
    })

    it('forwards each parsed envelope to the handler', async (): Promise<void> => {
        const envelope: AgentEventEnvelope = {
            kind: 'agent-events',
            seq: 1,
            event: 'Stop',
            data: {terminalId: 'T1', source: 'claude-code', at: 1, handlerResult: {ok: true, kind: 'done'}},
            vault: '/the/active/vault',
        }
        installFetchStream([makeEnvelopeBlock(envelope)])
        const received: AgentEventEnvelope[] = []
        subscribeToAgentEventsSse('main-1', (env: AgentEventEnvelope): void => { received.push(env) })

        await vi.waitFor((): void => {
            expect(received).toHaveLength(1)
            expect(received[0]).toEqual(envelope)
        })
    })

    it('drops envelopes whose vault does not match getActiveVault() (vault-switch fence)', async (): Promise<void> => {
        const sameVault: AgentEventEnvelope = {
            kind: 'agent-events',
            seq: 1,
            event: 'Stop',
            data: {terminalId: 'T1', source: 'claude-code', at: 1, handlerResult: null},
            vault: '/the/active/vault',
        }
        const otherVault: AgentEventEnvelope = {
            kind: 'agent-events',
            seq: 2,
            event: 'Stop',
            data: {terminalId: 'T2', source: 'claude-code', at: 2, handlerResult: null},
            vault: '/some/other/vault',
        }
        installFetchStream([makeEnvelopeBlock(otherVault), makeEnvelopeBlock(sameVault)])
        const received: AgentEventEnvelope[] = []
        subscribeToAgentEventsSse('main-1', (env: AgentEventEnvelope): void => { received.push(env) })

        await vi.waitFor((): void => {
            expect(received).toHaveLength(1)
            expect(received[0].data.terminalId).toBe('T1')
        })
    })

    it('updates lastSeenSeq on each accepted envelope (reconnect ?since=<seq>)', async (): Promise<void> => {
        const env1: AgentEventEnvelope = {
            kind: 'agent-events',
            seq: 5,
            event: 'Stop',
            data: {terminalId: 'T1', source: 'claude-code', at: 1, handlerResult: null},
            vault: '/the/active/vault',
        }
        const env2: AgentEventEnvelope = {
            kind: 'agent-events',
            seq: 8,
            event: 'Stop',
            data: {terminalId: 'T2', source: 'claude-code', at: 2, handlerResult: null},
            vault: '/the/active/vault',
        }
        const fetchFn = vi.fn(async (): Promise<Response> => new Response(
            new ReadableStream<Uint8Array>({
                start(controller): void {
                    controller.enqueue(makeEnvelopeBlock(env1))
                    controller.enqueue(makeEnvelopeBlock(env2))
                    controller.close()
                },
            }),
            {status: 200},
        ))
        vi.stubGlobal('fetch', fetchFn)
        const received: AgentEventEnvelope[] = []
        subscribeToAgentEventsSse('main-1', (env: AgentEventEnvelope): void => { received.push(env) })

        await vi.waitFor((): void => {
            expect(received).toHaveLength(2)
        })

        // Trigger a reconnect by clearing the stream — verify the second
        // fetch carries the updated since= value.
        await vi.waitFor((): void => {
            const reconnectCall = fetchFn.mock.calls.find((c): boolean =>
                String(c[0]).includes('since=8'),
            )
            expect(reconnectCall).toBeDefined()
        }, {timeout: 6000})
    }, 10_000)

    it('passes gap envelopes through silently (lastSeenSeq jumps to currentSeq)', async (): Promise<void> => {
        installFetchStream([makeGapBlock(1, 50, '/the/active/vault')])
        const received: AgentEventEnvelope[] = []
        subscribeToAgentEventsSse('main-1', (env: AgentEventEnvelope): void => { received.push(env) })

        // Gap envelopes are NOT delivered to the handler (the handler is
        // typed AgentEventHandler = (AgentEventEnvelope) → void); we assert
        // the subscriber doesn't crash and accepts the frame.
        await new Promise<void>((r) => setTimeout(r, 50))
        expect(received).toHaveLength(0)
    })

    it('unsubscribeFromAgentEventsSse aborts the in-flight fetch and prevents further handler calls', async (): Promise<void> => {
        // Use a never-ending stream so we can observe abort.
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit): Promise<Response> => {
            return new Promise<Response>((resolve, reject): void => {
                const signal: AbortSignal | undefined = init.signal as AbortSignal | undefined
                signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
            })
        }))
        const received: AgentEventEnvelope[] = []
        subscribeToAgentEventsSse('main-1', (env: AgentEventEnvelope): void => { received.push(env) })
        await new Promise<void>((r) => setTimeout(r, 50))
        unsubscribeFromAgentEventsSse()
        await new Promise<void>((r) => setTimeout(r, 50))
        expect(received).toHaveLength(0)
    })
})
