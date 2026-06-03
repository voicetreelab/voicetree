// Canonical consumer of graphd's projectedGraph SSE stream.
//
// graphd emits full `ProjectedGraph` snapshots on
// `GET /sessions/:id/events` framed as `event: projectedGraph\ndata: <json>`
// blocks (each snapshot carries `.seq`, resumable via `?since=`). The graph-db
// client owns graphd's wire format, so the SSE framing parser + the
// subscription helper live here — not duplicated in every consumer. Under the
// VTD gateway model (RE-PLAN B) the daemon's live-update pump is the consumer;
// the browser no longer reaches graphd directly.
//
// `createSseEventParser` is pure (closed-over buffer only, no I/O) so the
// framing logic stays unit-testable without a live server.

import type {ProjectedGraph} from '@vt/graph-state/contract'

/**
 * Stateful parser for the SSE wire format. graphd frames each event as an
 * `event: <name>\ndata: <json>\n\n` block — the event name carries the type
 * (e.g. `projectedGraph`), NOT a field inside the data. A `data:` line alone
 * loses the type, so the parser tracks the current `event:` line and pairs it
 * with the following `data:`. Feed it raw decoded chunks (which may split a
 * line across boundaries); it buffers the partial trailing line until completed.
 *
 * Returns a `push(chunk)` function. Pure aside from the closed-over buffer — no
 * I/O — so the framing logic is unit-testable without a live server.
 */
export function createSseEventParser(
    onEvent: (eventName: string, data: string) => void,
): (chunk: string) => void {
    let buf = ''
    let currentEvent = 'message'
    return (chunk: string): void => {
        buf += chunk
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
            if (line.startsWith('event:')) {
                currentEvent = line.slice('event:'.length).trim()
            } else if (line.startsWith('data: ')) {
                onEvent(currentEvent, line.slice('data: '.length))
            } else if (line === '') {
                currentEvent = 'message' // block boundary — reset for next event
            }
        }
    }
}

/**
 * Subscribe to a graphd session's `projectedGraph` SSE stream. Calls
 * `onSnapshot` with each decoded full snapshot and `onError` on a transport
 * failure (open failure, mid-stream read error). Ignores non-`projectedGraph`
 * events and unparseable `data:` lines (a malformed frame never throws into the
 * caller). Returns a cleanup function that aborts the underlying request.
 *
 * `sinceSeq` resumes from a known snapshot seq (graphd replays from there);
 * default `0` requests the stream from the start.
 */
export function subscribeProjectedGraph(
    baseUrl: string,
    sessionId: string,
    onSnapshot: (snapshot: ProjectedGraph) => void,
    onError: (err: unknown) => void,
    sinceSeq = 0,
): () => void {
    const abortController = new AbortController()
    const url = `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/events?since=${sinceSeq}`
    void (async (): Promise<void> => {
        try {
            const res = await fetch(url, {signal: abortController.signal})
            if (!res.ok || !res.body) throw new Error(`projectedGraph SSE open failed: ${res.status}`)
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            const push = createSseEventParser((eventName: string, data: string): void => {
                if (eventName !== 'projectedGraph') return
                let snapshot: ProjectedGraph
                try {
                    snapshot = JSON.parse(data) as ProjectedGraph
                } catch {
                    return // a malformed frame is dropped, not surfaced as an error
                }
                onSnapshot(snapshot)
            })
            for (;;) {
                const {done, value} = await reader.read()
                if (done) break
                push(decoder.decode(value, {stream: true}))
            }
        } catch (err) {
            if ((err as {name?: string}).name !== 'AbortError') onError(err)
        }
    })()
    return (): void => abortController.abort()
}
