// Black-box tests for the terminal-registry SSE route. Real http server,
// real subscriber; publish via the hub (the daemon's publish sink is just
// `hub.publish(TERMINAL_REGISTRY_TOPIC, event.type, event)` — see
// vtd.ts#buildPublishTerminalRegistryEvent), assert on parsed wire
// envelopes. No internal mocks.

import {afterEach, describe, expect, it} from 'vitest'

import {generateAuthToken} from '@vt/vt-rpc'
import {
    TERMINAL_REGISTRY_TOPIC,
    type TerminalId,
    type TerminalRegistryEvent,
} from '@vt/vt-daemon-protocol'

const asTerminalId = (id: string): TerminalId => id as TerminalId

import {buildJsonResponse, type McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import {
    startHttpDaemonServer,
    type HttpDaemonServerHandle,
    type ToolCatalog,
} from '../httpServer.ts'
import {
    encodeTerminalRegistrySseBlock,
    matchTerminalRegistryPath,
    projectHubEventToTerminalRegistryEnvelope,
    type TerminalRegistryFrame,
    type TerminalRegistryEnvelope,
} from '../sse/terminalRegistrySse.ts'

const NOOP_CATALOG: ToolCatalog = new Map<string, (a: Record<string, unknown>) => Promise<McpToolResponse>>([
    ['echo', async (args): Promise<McpToolResponse> => buildJsonResponse({echoed: args})],
])

interface Ctx {
    handle: HttpDaemonServerHandle
    token: string
    project: string
}

const active: Ctx[] = []

afterEach(async (): Promise<void> => {
    while (active.length > 0) {
        const c: Ctx = active.pop()!
        await c.handle.stop().catch((): void => {})
    }
})

interface BringOptions {
    readonly canonicalProject?: string | null
}

async function bring(opts: BringOptions = {}): Promise<Ctx> {
    const canonicalProject: string | undefined = opts.canonicalProject === undefined
        ? '/canonical/project'
        : opts.canonicalProject === null
            ? undefined
            : opts.canonicalProject
    const token: string = generateAuthToken()
    const handle: HttpDaemonServerHandle = await startHttpDaemonServer({
        catalog: NOOP_CATALOG,
        token,
        bindHost: '127.0.0.1',
        canonicalProject,
        logger: {logRequest: (): void => {}, logError: (): void => {}},
    })
    const ctx: Ctx = {handle, token, project: canonicalProject ?? ''}
    active.push(ctx)
    return ctx
}

interface SseReaderHandle {
    readonly frames: TerminalRegistryFrame[]
    readonly close: () => void
    readonly waitForFrame: (predicate: (frame: TerminalRegistryFrame) => boolean, timeoutMs?: number) => Promise<TerminalRegistryFrame>
}

function openSseReader(url: string, token: string): SseReaderHandle {
    const controller: AbortController = new AbortController()
    const frames: TerminalRegistryFrame[] = []
    const waiters: Array<{predicate: (f: TerminalRegistryFrame) => boolean; resolve: (f: TerminalRegistryFrame) => void}> = []

    function notify(frame: TerminalRegistryFrame): void {
        frames.push(frame)
        for (let i: number = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].predicate(frame)) {
                waiters[i].resolve(frame)
                waiters.splice(i, 1)
            }
        }
    }

    void (async (): Promise<void> => {
        const res: Response = await fetch(url, {
            headers: {Authorization: `Bearer ${token}`},
            signal: controller.signal,
        })
        if (!res.ok || !res.body) return
        const reader: ReadableStreamDefaultReader<Uint8Array> = res.body.getReader()
        const decoder: TextDecoder = new TextDecoder()
        let buffered: string = ''
        while (!controller.signal.aborted) {
            const result: ReadableStreamReadResult<Uint8Array> = await reader.read().catch((): ReadableStreamReadResult<Uint8Array> => ({done: true, value: undefined}))
            if (result.done) return
            buffered += decoder.decode(result.value, {stream: true})
            const blocks: string[] = buffered.split('\n\n')
            buffered = blocks.pop() ?? ''
            for (const block of blocks) {
                const dataLine: string | undefined = block.split('\n').find((l: string) => l.startsWith('data:'))
                if (!dataLine) continue
                try {
                    const parsed: TerminalRegistryFrame = JSON.parse(dataLine.slice('data:'.length).trim())
                    notify(parsed)
                } catch {
                    // skip malformed
                }
            }
        }
    })().catch((): void => {})

    return {
        frames,
        close: (): void => { controller.abort() },
        waitForFrame: (predicate, timeoutMs = 2000): Promise<TerminalRegistryFrame> => {
            const existing: TerminalRegistryFrame | undefined = frames.find(predicate)
            if (existing) return Promise.resolve(existing)
            return new Promise<TerminalRegistryFrame>((resolve, reject) => {
                const timeout: NodeJS.Timeout = setTimeout((): void => {
                    reject(new Error(`waitForFrame timed out after ${timeoutMs}ms; frames so far=${JSON.stringify(frames)}`))
                }, timeoutMs)
                waiters.push({
                    predicate,
                    resolve: (f: TerminalRegistryFrame): void => {
                        clearTimeout(timeout)
                        resolve(f)
                    },
                })
            })
        },
    }
}

function publishTerminalRegistry(
    handle: HttpDaemonServerHandle,
    event: TerminalRegistryEvent,
): void {
    handle.hub.publish(TERMINAL_REGISTRY_TOPIC, event.type, event)
}

describe('matchTerminalRegistryPath — pure helper', (): void => {
    it('extracts a session id from a well-formed path', (): void => {
        expect(matchTerminalRegistryPath('/sessions/abc-123/terminal-registry')).toBe('abc-123')
    })
    it('returns null when prefix is missing', (): void => {
        expect(matchTerminalRegistryPath('/abc-123/terminal-registry')).toBeNull()
    })
    it('returns null when suffix is missing', (): void => {
        expect(matchTerminalRegistryPath('/sessions/abc-123/agent-events')).toBeNull()
    })
    it('returns null on extra path segments', (): void => {
        expect(matchTerminalRegistryPath('/sessions/abc/extra/terminal-registry')).toBeNull()
    })
    it('returns null on empty session id', (): void => {
        expect(matchTerminalRegistryPath('/sessions//terminal-registry')).toBeNull()
    })
})

describe('projectHubEventToTerminalRegistryEnvelope — pure projector', (): void => {
    it('projects a well-formed terminal-removed event', (): void => {
        const event: TerminalRegistryEvent = {type: 'terminal-removed', terminalId: asTerminalId('T1')}
        const env: TerminalRegistryEnvelope | null = projectHubEventToTerminalRegistryEnvelope(7, event, '/v')
        expect(env).toEqual({
            kind: 'terminal-registry',
            seq: 7,
            event,
            project: '/v',
        })
    })
    it('returns null when type is missing', (): void => {
        expect(projectHubEventToTerminalRegistryEnvelope(1, {terminalId: 'T1'}, '/v')).toBeNull()
    })
    it('returns null on unknown event type', (): void => {
        expect(projectHubEventToTerminalRegistryEnvelope(1, {type: 'bogus'}, '/v')).toBeNull()
    })
    it('returns null on non-object data', (): void => {
        expect(projectHubEventToTerminalRegistryEnvelope(1, 'hello', '/v')).toBeNull()
        expect(projectHubEventToTerminalRegistryEnvelope(1, null, '/v')).toBeNull()
    })
})

describe('encodeTerminalRegistrySseBlock — wire format', (): void => {
    it('produces a `data:` line and trailing blank line', (): void => {
        const block: string = encodeTerminalRegistrySseBlock({
            kind: 'terminal-registry',
            seq: 1,
            event: {type: 'terminal-removed', terminalId: asTerminalId('T1')},
            project: '/v',
        })
        expect(block.startsWith('data: ')).toBe(true)
        expect(block.endsWith('\n\n')).toBe(true)
        const jsonLine: string = block.split('\n')[0]
        expect(jsonLine).toMatch(/^data: \{.*\}$/)
    })
})

describe('GET /sessions/:sessionId/terminal-registry — black-box', (): void => {
    it('streams a terminal-registry frame after a matching publish', async (): Promise<void> => {
        const {handle, token, project} = await bring({canonicalProject: '/the/project'})
        const url: string = `${handle.url}/sessions/sess-1/terminal-registry`
        const reader: SseReaderHandle = openSseReader(url, token)

        // Give the SSE subscription time to register before the publish.
        await new Promise<void>((r) => setTimeout(r, 50))

        publishTerminalRegistry(handle, {type: 'terminal-removed', terminalId: asTerminalId('T1')})

        const frame: TerminalRegistryFrame = await reader.waitForFrame((f) => f.kind === 'terminal-registry')
        reader.close()
        if (frame.kind !== 'terminal-registry') throw new Error('unreachable')
        expect(frame.event).toEqual({type: 'terminal-removed', terminalId: 'T1'})
        expect(frame.project).toBe(project)
        expect(typeof frame.seq).toBe('number')
    })

    it('rejects with 401 on missing/bad bearer token', async (): Promise<void> => {
        const {handle} = await bring()
        const res = await fetch(`${handle.url}/sessions/sess-1/terminal-registry`, {
            headers: {Authorization: 'Bearer wrong'},
        })
        expect(res.status).toBe(401)
    })

    it('returns 503 with explanatory body when canonicalProject is not wired', async (): Promise<void> => {
        const {handle, token} = await bring({canonicalProject: null})
        const res = await fetch(`${handle.url}/sessions/sess-1/terminal-registry`, {
            headers: {Authorization: `Bearer ${token}`},
        })
        expect(res.status).toBe(503)
        const body = await res.json() as {error: string}
        expect(body.error).toMatch(/canonicalProject/)
    })

    it('replays buffered frames from ?since=<seq>', async (): Promise<void> => {
        const {handle, token, project} = await bring({canonicalProject: '/v'})
        // Publish 3 events BEFORE any subscriber connects.
        for (let i: number = 1; i <= 3; i++) {
            publishTerminalRegistry(handle, {type: 'terminal-removed', terminalId: asTerminalId(`T${i}`)})
        }
        // Subscribe with ?since=2 — should replay seqs 2,3.
        const url: string = `${handle.url}/sessions/sess-1/terminal-registry?since=2`
        const reader: SseReaderHandle = openSseReader(url, token)
        await reader.waitForFrame((f) => f.kind === 'terminal-registry' && f.seq === 3)
        const replayed: TerminalRegistryEnvelope[] = reader.frames
            .filter((f): f is TerminalRegistryEnvelope => f.kind === 'terminal-registry')
        reader.close()
        expect(replayed.map((f) => f.seq)).toEqual([2, 3])
        expect(replayed.every((f) => f.project === project)).toBe(true)
    })

    it('emits a gap frame when ?since= is older than the resume buffer', async (): Promise<void> => {
        const {handle, token, project} = await bring({canonicalProject: '/v'})
        // Burn past the resume-buffer ceiling (RESUME_BUFFER_SIZE=100 in
        // eventSubscriptionHub) so seq=1 has rotated out.
        for (let i: number = 1; i <= 110; i++) {
            publishTerminalRegistry(handle, {type: 'terminal-removed', terminalId: asTerminalId(`T${i}`)})
        }
        const url: string = `${handle.url}/sessions/sess-1/terminal-registry?since=1`
        const reader: SseReaderHandle = openSseReader(url, token)
        const frame: TerminalRegistryFrame = await reader.waitForFrame(
            (f) => f.kind === 'terminal-registry-gap',
        )
        reader.close()
        if (frame.kind !== 'terminal-registry-gap') throw new Error('unreachable')
        expect(frame.fromSeq).toBe(1)
        expect(frame.currentSeq).toBeGreaterThanOrEqual(110)
        expect(frame.project).toBe(project)
    })

    it('closes the SSE stream when the client aborts', async (): Promise<void> => {
        const {handle, token} = await bring({canonicalProject: '/v'})
        const reader: SseReaderHandle = openSseReader(
            `${handle.url}/sessions/sess-1/terminal-registry`,
            token,
        )
        await new Promise<void>((r) => setTimeout(r, 50))
        reader.close()
        publishTerminalRegistry(handle, {type: 'terminal-removed', terminalId: asTerminalId('T1')})
        await new Promise<void>((r) => setTimeout(r, 50))
        // No assertion beyond "did not throw" — passes if shutdown is clean.
    })

    it('returns 404 on a non-matching GET under /sessions/', async (): Promise<void> => {
        const {handle, token} = await bring({canonicalProject: '/v'})
        const res = await fetch(`${handle.url}/sessions/sess-1/other-route`, {
            headers: {Authorization: `Bearer ${token}`},
        })
        expect(res.status).toBe(404)
    })
})
