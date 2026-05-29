/**
 * The wrapper shape is load-bearing: agents read the body and follow the
 * embedded "use `vt agent send` to reply" hint. If the format silently
 * changes, the inter-agent reply loop breaks. These tests lock the
 * literal shape so a refactor of the wrapper module surfaces in CI.
 */

import {describe, expect, it} from 'vitest'
import {buildFromPrefixedMessage} from './from-prefix-message'

describe('buildFromPrefixedMessage', () => {
    it('wraps the message with the [From: <caller>] prefix', () => {
        const wrapped: string = buildFromPrefixedMessage('Aki', 'check the diff')
        expect(wrapped).toMatch(/^\[From: Aki\] check the diff/)
    })

    it('embeds the reply hint pointing back at the caller terminal', () => {
        const wrapped: string = buildFromPrefixedMessage('Aki', 'hello')
        expect(wrapped).toContain("'vt agent send' to Aki")
    })

    it('warns receivers off built-in messaging tools', () => {
        const wrapped: string = buildFromPrefixedMessage('Aki', 'hello')
        expect(wrapped).toContain('DO NOT USE SendMessage')
    })

    it('separates the body from the reply hint with a blank line', () => {
        const wrapped: string = buildFromPrefixedMessage('Aki', 'body')
        expect(wrapped).toContain('body\n\nIf you need to reply')
    })
})
