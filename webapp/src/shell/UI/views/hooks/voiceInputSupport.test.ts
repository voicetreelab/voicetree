// Black-box truth table for the pure voice-input support decision. Encodes the
// contract: capture needs BOTH a secure context AND getUserMedia — the insecure
// LAN-over-http phone case (secure=false) must read as unsupported so the UI
// degrades instead of letting the Soniox constructor throw at render.
import {describe, it, expect} from 'vitest'
import {voiceInputSupported} from './voiceInputSupport'

describe('voiceInputSupported', (): void => {
    it('supported only when secure context AND getUserMedia present', (): void => {
        expect(voiceInputSupported({isSecureContext: true, hasGetUserMedia: true})).toBe(true)
    })

    it('unsupported in an insecure context even with getUserMedia (LAN http phone)', (): void => {
        expect(voiceInputSupported({isSecureContext: false, hasGetUserMedia: true})).toBe(false)
    })

    it('unsupported when getUserMedia is missing even in a secure context', (): void => {
        expect(voiceInputSupported({isSecureContext: true, hasGetUserMedia: false})).toBe(false)
    })

    it('unsupported when neither holds', (): void => {
        expect(voiceInputSupported({isSecureContext: false, hasGetUserMedia: false})).toBe(false)
    })
})
