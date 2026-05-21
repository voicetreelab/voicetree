/**
 * Black-box tests for the tiny dedicated hook HTTP server. Spawn it on an
 * ephemeral port, POST real hook payloads with `fetch`, observe responses
 * and the side-effect on a captured updateAgentEvent dep.
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {AgentEventKind} from '@vt/agent-runtime'
import {startHookHttpServer, type HookHttpServerHandle} from './hookHttpServer'

type Event = {readonly terminalId: string; readonly kind: AgentEventKind}

describe('startHookHttpServer', () => {
    let handle: HookHttpServerHandle | null = null
    let events: Event[] = []
    const silentLogger = {
        log: (): void => {},
        error: (): void => {},
    }

    beforeEach(async (): Promise<void> => {
        events = []
        handle = await startHookHttpServer({
            updateAgentEvent: (terminalId: string, kind: AgentEventKind): void => {
                events.push({terminalId, kind})
            },
            logger: silentLogger,
        })
    })

    afterEach(async (): Promise<void> => {
        if (handle) {
            await handle.stop()
            handle = null
        }
    })

    function url(path: string): string {
        if (!handle) throw new Error('server handle not set')
        return `http://127.0.0.1:${handle.port}${path}`
    }

    it('binds an ephemeral port on 127.0.0.1', () => {
        expect(handle!.port).toBeGreaterThan(0)
    })

    it('dispatches a Claude Code Stop event to updateAgentEvent', async () => {
        const res = await fetch(url('/hook/claude-code?terminal=cc-1&event=Stop'), {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({hook_event_name: 'Stop'}),
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ok: true, kind: 'awaiting'})
        expect(events).toEqual([{terminalId: 'cc-1', kind: 'awaiting'}])
    })

    it('falls back to ?event= query param when body has no Content-Type / hook_event_name', async () => {
        // Reproduces the production shape: Codex/Claude hook subprocess POSTs
        // without Content-Type, body parser sees nothing — query-param wins.
        const res = await fetch(url('/hook/codex?terminal=codex-1&event=Stop'), {method: 'POST'})
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ok: true, kind: 'awaiting'})
        expect(events).toEqual([{terminalId: 'codex-1', kind: 'awaiting'}])
    })

    it('unknown source short-circuits with ok:false (no event fired)', async () => {
        const res = await fetch(url('/hook/aider?terminal=x&event=Stop'), {method: 'POST'})
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ok: false, reason: 'unknown_source'})
        expect(events).toEqual([])
    })

    it('missing terminal short-circuits with ok:false', async () => {
        const res = await fetch(url('/hook/claude-code?event=Stop'), {method: 'POST'})
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ok: false, reason: 'missing_terminal_or_event'})
    })

    it('returns ok:false for non-hook routes (no 404 — fail-quiet)', async () => {
        const res = await fetch(url('/something-else'), {method: 'POST'})
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ok: false, reason: 'not_found'})
    })

    it('returns ok:false for GET requests on hook routes', async () => {
        const res = await fetch(url('/hook/claude-code?terminal=x&event=Stop'))
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ok: false, reason: 'not_found'})
    })

    it('fail-quiet: a throwing updateAgentEvent still produces a 200 reply', async () => {
        await handle!.stop()
        handle = await startHookHttpServer({
            updateAgentEvent: (): void => {
                throw new Error('simulated lifecycle bug')
            },
            logger: silentLogger,
        })
        const res = await fetch(url('/hook/claude-code?terminal=x&event=Stop'), {method: 'POST'})
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ok: false, reason: 'exception'})
    })

    it('honours explicit port option (pin for tests)', async () => {
        await handle!.stop()
        handle = await startHookHttpServer({
            updateAgentEvent: (): void => {},
            logger: silentLogger,
        })
        const pinned: number = handle.port
        await handle.stop()
        handle = await startHookHttpServer({
            updateAgentEvent: (): void => {},
            port: pinned,
            logger: silentLogger,
        })
        expect(handle.port).toBe(pinned)
    })
})
