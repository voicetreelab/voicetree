/**
 * Black-box tests for the pure relay envelope codec. Call the function, assert
 * on the output. No WebSocket, no mocks.
 */
import {describe, expect, it} from 'vitest'
import {
    decodeWsData,
    parseRelayServerMessage,
    serializeRelayClientMessage,
    type RelayClientMessage,
} from './relayEnvelope'

describe('parseRelayServerMessage', (): void => {
    it('parses a data frame into {type,payload}', (): void => {
        expect(parseRelayServerMessage('{"type":"data","payload":"x"}')).toEqual({type: 'data', payload: 'x'})
    })

    it('parses an exit frame, preserving the code', (): void => {
        expect(parseRelayServerMessage('{"type":"exit","code":0}')).toEqual({type: 'exit', code: 0})
    })

    it('normalizes an exit frame without a numeric code to code:null', (): void => {
        expect(parseRelayServerMessage('{"type":"exit"}')).toEqual({type: 'exit', code: null})
    })

    it('returns null for non-JSON input', (): void => {
        expect(parseRelayServerMessage('not json')).toBeNull()
    })

    it('returns null for a data frame missing its payload', (): void => {
        expect(parseRelayServerMessage('{"type":"data"}')).toBeNull()
    })

    it('returns null for an unknown frame type', (): void => {
        expect(parseRelayServerMessage('{"type":"bogus"}')).toBeNull()
    })

    it('returns null for a non-object JSON value', (): void => {
        expect(parseRelayServerMessage('42')).toBeNull()
    })
})

describe('serializeRelayClientMessage', (): void => {
    it('serializes a data frame', (): void => {
        expect(serializeRelayClientMessage({type: 'data', payload: 'x'})).toBe('{"type":"data","payload":"x"}')
    })

    it('serializes a resize frame', (): void => {
        expect(serializeRelayClientMessage({type: 'resize', cols: 80, rows: 24})).toBe('{"type":"resize","cols":80,"rows":24}')
    })

    it('serializes a scroll frame', (): void => {
        expect(serializeRelayClientMessage({type: 'scroll', direction: 'up', lines: 3})).toBe('{"type":"scroll","direction":"up","lines":3}')
    })
})

describe('decodeWsData', (): void => {
    it('passes a string through unchanged', (): void => {
        expect(decodeWsData('hello')).toBe('hello')
    })

    it('decodes an ArrayBuffer as utf-8', (): void => {
        // Build the ArrayBuffer via the global constructor so it shares the realm
        // the module sees — mirroring a real browser binary frame (binaryType
        // 'arraybuffer'), rather than TextEncoder's cross-realm backing buffer.
        const encoded: Uint8Array = new TextEncoder().encode('héllo')
        const buffer: ArrayBuffer = new ArrayBuffer(encoded.byteLength)
        new Uint8Array(buffer).set(encoded)
        expect(decodeWsData(buffer)).toBe('héllo')
    })

    it('decodes a Node Buffer as utf-8', (): void => {
        expect(decodeWsData(Buffer.from('héllo', 'utf-8'))).toBe('héllo')
    })

    it('decodes an array of Buffers as utf-8', (): void => {
        expect(decodeWsData([Buffer.from('hé', 'utf-8'), Buffer.from('llo', 'utf-8')])).toBe('héllo')
    })

    it('returns empty string for unrecognized input', (): void => {
        expect(decodeWsData(42)).toBe('')
    })
})

/**
 * Drift guard: a copy of the relay's client-frame accept predicate
 * (tmux-attach-relay.ts `parseWsMessage` + the message handler). Every frame
 * `serializeRelayClientMessage` produces must be accepted by the relay, so this
 * test fails loudly if the codec and the server ever diverge.
 */
function relayAccepts(rawFrame: string): boolean {
    let record: Record<string, unknown> | null = null
    try {
        const parsed: unknown = JSON.parse(rawFrame)
        if (parsed && typeof parsed === 'object') record = parsed as Record<string, unknown>
    } catch {
        return false
    }
    if (!record) return false
    if ((record.type === 'input' || record.type === 'data') && typeof record.payload === 'string') return true
    if (record.type === 'resize') {
        return Number.isFinite(Number(record.cols)) && Number.isFinite(Number(record.rows))
    }
    if (record.type === 'scroll') {
        return (record.direction === 'up' || record.direction === 'down') && Number.isFinite(Number(record.lines))
    }
    return false
}

describe('serializeRelayClientMessage is accepted by the relay (drift guard)', (): void => {
    const cases: readonly RelayClientMessage[] = [
        {type: 'data', payload: 'q'},
        {type: 'resize', cols: 100, rows: 40},
        {type: 'scroll', direction: 'up', lines: 5},
        {type: 'scroll', direction: 'down', lines: 1},
    ]
    for (const msg of cases) {
        it(`relay accepts a ${msg.type} frame`, (): void => {
            expect(relayAccepts(serializeRelayClientMessage(msg))).toBe(true)
        })
    }
})
