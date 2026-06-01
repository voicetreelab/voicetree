// Black-box tests for the graphd SSE frame parser.
//
// Regression guard for the browser "nodes never update" bug: graphd sends
// `event: projectedGraph\ndata: <json>\n\n`, carrying the type in the event
// NAME, not a field in the data. An earlier parser read only `data:` lines and
// matched on a non-existent `data.type`, so graph updates never reached the UI.

import {describe, expect, it} from 'vitest'
import {createSseEventParser} from './graphdFetch'

function collect(chunks: readonly string[]): Array<[string, string]> {
    const out: Array<[string, string]> = []
    const push = createSseEventParser((name, data) => out.push([name, data]))
    for (const c of chunks) push(c)
    return out
}

describe('createSseEventParser', () => {
    it('pairs the event name with its data line', () => {
        expect(collect(['event: projectedGraph\ndata: {"nodes":[]}\n\n']))
            .toEqual([['projectedGraph', '{"nodes":[]}']])
    })

    it('reassembles a frame split across chunk boundaries', () => {
        // The event name, the data, and even the JSON can arrive in separate reads.
        const out = collect(['event: projec', 'tedGraph\nda', 'ta: {"nodes":', '[1,2]}\n\n'])
        expect(out).toEqual([['projectedGraph', '{"nodes":[1,2]}']])
    })

    it('keeps event names distinct across consecutive frames', () => {
        const out = collect([
            'event: projectedGraph\ndata: A\n\n',
            'event: clear\ndata: B\n\n',
        ])
        expect(out).toEqual([['projectedGraph', 'A'], ['clear', 'B']])
    })

    it('does not leak a prior event name onto an unnamed (default) frame', () => {
        // After a complete frame the name resets, so a bare `data:` is `message`,
        // never a stale `projectedGraph`.
        const out = collect(['event: projectedGraph\ndata: A\n\n', 'data: B\n\n'])
        expect(out).toEqual([['projectedGraph', 'A'], ['message', 'B']])
    })

    it('ignores comment/keepalive lines (`: keepalive`) without emitting', () => {
        const out = collect([': connected\n\n', ': keepalive\n\n', 'event: projectedGraph\ndata: X\n\n'])
        expect(out).toEqual([['projectedGraph', 'X']])
    })
})
