// Black-box tests for the pure reconnect backoff. Call the function with an
// attempt index, assert the returned delay — no timers, no sockets.

import {describe, expect, it} from 'vitest'
import {DEFAULT_RECONNECT_POLICY, reconnectDelayMs, type ReconnectPolicy} from './reconnectPolicy'

describe('reconnectDelayMs', () => {
    it('grows geometrically from the base then saturates at the cap', () => {
        const seq = [0, 1, 2, 3, 4, 5, 6].map(a => reconnectDelayMs(DEFAULT_RECONNECT_POLICY, a))
        // 1s, 2s, 4s, 8s, 16s, then capped at 30s (32s and 64s clamp down).
        expect(seq).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
    })

    it('never exceeds maxDelayMs for arbitrarily large attempts', () => {
        expect(reconnectDelayMs(DEFAULT_RECONNECT_POLICY, 100)).toBe(30000)
    })

    it('clamps negative attempts to the base delay (no NaN / sub-base wait)', () => {
        expect(reconnectDelayMs(DEFAULT_RECONNECT_POLICY, -5)).toBe(1000)
    })

    it('honours a custom policy', () => {
        const policy: ReconnectPolicy = {baseDelayMs: 500, maxDelayMs: 4000, factor: 3}
        expect([0, 1, 2, 3].map(a => reconnectDelayMs(policy, a))).toEqual([500, 1500, 4000, 4000])
    })
})
