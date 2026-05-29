// Black-box tests for the agent-events SSE route. Each test brings up a
// real http.createServer (via startHttpDaemonServer) on port 0, opens an
// SSE connection over the loopback wire, posts a hook to drive the
// publish, and asserts on the parsed wire envelopes. No internal mocks.

import {afterEach, describe, expect, it} from 'vitest'

import {generateAuthToken} from '@vt/vt-rpc'

import {buildJsonResponse, type McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import {
    startHttpDaemonServer,
    type HookHandler,
    type HttpDaemonServerHandle,
    type ToolCatalog,
} from '../httpServer.ts'
import {
    encodeSseBlock,
    matchAgentEventsPath,
    parseSinceQuery,
    projectHubEventToEnvelope,
    type AgentEventsFrame,
    type AgentEventEnvelope,
} from '../agentEventsSse.ts'

const noopHook: HookHandler = (): unknown => ({ok: true})
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
        hookHandler: noopHook,
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
    readonly frames: AgentEventsFrame[]
    readonly close: () => void
    readonly waitForFrame: (predicate: (frame: AgentEventsFrame) => boolean, timeoutMs?: number) => Promise<AgentEventsFrame>
}

function openSseReader(url: string, token: string): SseReaderHandle {
    const controller: AbortController = new AbortController()
    const frames: AgentEventsFrame[] = []
    const waiters: Array<{predicate: (f: AgentEventsFrame) => boolean; resolve: (f: AgentEventsFrame) => void}> = []

    function notify(frame: AgentEventsFrame): void {
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
                    const parsed: AgentEventsFrame = JSON.parse(dataLine.slice('data:'.length).trim())
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
        waitForFrame: (predicate, timeoutMs = 2000): Promise<AgentEventsFrame> => {
            const existing: AgentEventsFrame | undefined = frames.find(predicate)
            if (existing) return Promise.resolve(existing)
            return new Promise<AgentEventsFrame>((resolve, reject) => {
                const timeout: NodeJS.Timeout = setTimeout((): void => {
                    reject(new Error(`waitForFrame timed out after ${timeoutMs}ms; frames so far=${JSON.stringify(frames)}`))
                }, timeoutMs)
                waiters.push({
                    predicate,
                    resolve: (f: AgentEventsFrame): void => {
                        clearTimeout(timeout)
                        resolve(f)
                    },
                })
            })
        },
    }
}

describe('matchAgentEventsPath — pure helper', (): void => {
    it('extracts a session id from a well-formed path', (): void => {
        expect(matchAgentEventsPath('/sessions/abc-123/agent-events')).toBe('abc-123')
    })
    it('returns null when prefix is missing', (): void => {
        expect(matchAgentEventsPath('/abc-123/agent-events')).toBeNull()
    })
    it('returns null when suffix is missing', (): void => {
        expect(matchAgentEventsPath('/sessions/abc-123/events')).toBeNull()
    })
    it('returns null on extra path segments', (): void => {
        expect(matchAgentEventsPath('/sessions/abc/extra/agent-events')).toBeNull()
    })
    it('returns null on empty session id', (): void => {
        expect(matchAgentEventsPath('/sessions//agent-events')).toBeNull()
    })
})

describe('parseSinceQuery — pure helper', (): void => {
    it('returns 0 when absent', (): void => {
        expect(parseSinceQuery('/sessions/x/agent-events')).toBe(0)
    })
    it('parses integer query value', (): void => {
        expect(parseSinceQuery('/sessions/x/agent-events?since=42')).toBe(42)
    })
    it('returns 0 on non-finite values', (): void => {
        expect(parseSinceQuery('/sessions/x/agent-events?since=abc')).toBe(0)
        expect(parseSinceQuery('/sessions/x/agent-events?since=-1')).toBe(0)
    })
})

describe('projectHubEventToEnvelope — pure projector', (): void => {
    it('projects a well-formed publish payload', (): void => {
        const env: AgentEventEnvelope | null = projectHubEventToEnvelope(
            7,
            'Stop',
            {terminalId: 'T1', source: 'claude-code', at: 1727712345678, handlerResult: {ok: true}},
            '/v',
        )
        expect(env).toEqual({
            kind: 'agent-events',
            seq: 7,
            event: 'Stop',
            data: {terminalId: 'T1', source: 'claude-code', at: 1727712345678, handlerResult: {ok: true}},
            project: '/v',
        })
    })
    it('returns null when terminalId is missing', (): void => {
        expect(projectHubEventToEnvelope(1, 'Stop', {source: 'x', at: 1}, '/v')).toBeNull()
    })
    it('returns null on non-object data', (): void => {
        expect(projectHubEventToEnvelope(1, 'Stop', 'hello', '/v')).toBeNull()
        expect(projectHubEventToEnvelope(1, 'Stop', null, '/v')).toBeNull()
    })
})

describe('encodeSseBlock — wire format', (): void => {
    it('produces a `data:` line and trailing blank line', (): void => {
        const block: string = encodeSseBlock({
            kind: 'agent-events',
            seq: 1,
            event: 'Stop',
            data: {terminalId: 'T1', source: 'claude-code', at: 1, handlerResult: null},
            project: '/v',
        })
        expect(block.startsWith('data: ')).toBe(true)
        expect(block.endsWith('\n\n')).toBe(true)
        // Single JSON line — no embedded newlines (consumers split on \n\n).
        const jsonLine: string = block.split('\n')[0]
        expect(jsonLine).toMatch(/^data: \{.*\}$/)
    })
})

describe('GET /sessions/:sessionId/agent-events — black-box', (): void => {
    it('streams an agent-events frame after a matching hook fires', async (): Promise<void> => {
        const {handle, token, project} = await bring({canonicalProject: '/the/project'})
        const url: string = `${handle.url}/sessions/sess-1/agent-events`
        const reader: SseReaderHandle = openSseReader(url, token)

        // Give the SSE subscription time to register before the publish.
        await new Promise<void>((r) => setTimeout(r, 50))

        await fetch(`${handle.url}/hook/claude-code?terminal=T1&event=Stop`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: '{}',
        })

        const frame: AgentEventsFrame = await reader.waitForFrame((f) => f.kind === 'agent-events')
        reader.close()
        if (frame.kind !== 'agent-events') throw new Error('unreachable')
        expect(frame.event).toBe('Stop')
        expect(frame.data.terminalId).toBe('T1')
        expect(frame.data.source).toBe('claude-code')
        expect(frame.project).toBe(project)
        expect(typeof frame.seq).toBe('number')
    })

    it('rejects with 401 on missing/bad bearer token', async (): Promise<void> => {
        const {handle} = await bring()
        const res = await fetch(`${handle.url}/sessions/sess-1/agent-events`, {
            headers: {Authorization: 'Bearer wrong'},
        })
        expect(res.status).toBe(401)
    })

    it('returns 503 with explanatory body when canonicalProject is not wired', async (): Promise<void> => {
        const {handle, token} = await bring({canonicalProject: null})
        const res = await fetch(`${handle.url}/sessions/sess-1/agent-events`, {
            headers: {Authorization: `Bearer ${token}`},
        })
        expect(res.status).toBe(503)
        const body = await res.json() as {error: string}
        expect(body.error).toMatch(/canonicalProject/)
    })

    it('replays buffered frames from ?since=<seq>', async (): Promise<void> => {
        const {handle, token, project} = await bring({canonicalProject: '/v'})
        // Publish 3 hook events BEFORE any subscriber connects.
        for (let i: number = 1; i <= 3; i++) {
            await fetch(`${handle.url}/hook/claude-code?terminal=T${i}&event=Stop`, {
                method: 'POST',
                headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
                body: '{}',
            })
        }
        // Subscribe with ?since=2 — should replay seqs 2,3.
        const url: string = `${handle.url}/sessions/sess-1/agent-events?since=2`
        const reader: SseReaderHandle = openSseReader(url, token)
        await reader.waitForFrame((f) => f.kind === 'agent-events' && f.seq === 3)
        const replayed: AgentEventEnvelope[] = reader.frames
            .filter((f): f is AgentEventEnvelope => f.kind === 'agent-events')
        reader.close()
        expect(replayed.map((f) => f.seq)).toEqual([2, 3])
        expect(replayed.every((f) => f.project === project)).toBe(true)
    })

    it('closes the SSE stream when the client aborts', async (): Promise<void> => {
        const {handle, token} = await bring({canonicalProject: '/v'})
        const reader: SseReaderHandle = openSseReader(
            `${handle.url}/sessions/sess-1/agent-events`,
            token,
        )
        await new Promise<void>((r) => setTimeout(r, 50))
        reader.close()
        // After abort, a publish should not cause a server crash.
        await fetch(`${handle.url}/hook/claude-code?terminal=T1&event=Stop`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: '{}',
        })
        // No frames should arrive on the closed reader.
        await new Promise<void>((r) => setTimeout(r, 50))
        // No assertion here beyond "did not throw" — the test passes if
        // shutdown was clean (afterEach stops the server).
    })

    it('returns 404 on a non-sessions GET that does not match the SSE route', async (): Promise<void> => {
        const {handle, token} = await bring({canonicalProject: '/v'})
        const res = await fetch(`${handle.url}/sessions/sess-1/other-route`, {
            headers: {Authorization: `Bearer ${token}`},
        })
        expect(res.status).toBe(404)
    })
})
