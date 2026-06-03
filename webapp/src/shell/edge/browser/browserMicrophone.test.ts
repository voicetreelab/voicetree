// Black-box tests for the browser microphone edge. We inject the navigator
// surface each function adapts (its environment boundary, not an internal
// collaborator) and assert on the observable return value / side effect.

import {describe, expect, it} from 'vitest'
import {queryMicrophonePermission, requestMicrophoneAccess} from './browserMicrophone'

type PermNav = Pick<Navigator, 'permissions'>
type MediaNav = Pick<Navigator, 'mediaDevices'>

describe('queryMicrophonePermission', () => {
    it('maps the Permissions API states onto the Electron contract', async () => {
        for (const [state, expected] of [
            ['granted', 'granted'],
            ['denied', 'denied'],
            ['prompt', 'not-determined'],
        ] as const) {
            const nav = {permissions: {query: async () => ({state})}} as unknown as PermNav
            expect(await queryMicrophonePermission(nav)).toBe(expected)
        }
    })

    it('returns not-determined when the Permissions API is absent', async () => {
        expect(await queryMicrophonePermission({permissions: undefined} as unknown as PermNav))
            .toBe('not-determined')
    })

    it('returns not-determined when the query throws (unsupported descriptor)', async () => {
        const nav = {permissions: {query: async () => { throw new Error('TypeError: microphone') }}} as unknown as PermNav
        expect(await queryMicrophonePermission(nav)).toBe('not-determined')
    })
})

describe('requestMicrophoneAccess', () => {
    it('returns true and releases every track when access is granted', async () => {
        const stopped: boolean[] = []
        const tracks = [{stop: () => stopped.push(true)}, {stop: () => stopped.push(true)}]
        const nav = {mediaDevices: {getUserMedia: async () => ({getTracks: () => tracks})}} as unknown as MediaNav
        expect(await requestMicrophoneAccess(nav)).toBe(true)
        expect(stopped).toEqual([true, true]) // both capture tracks stopped
    })

    it('returns false when the user denies access', async () => {
        const nav = {mediaDevices: {getUserMedia: async () => { throw new Error('NotAllowedError') }}} as unknown as MediaNav
        expect(await requestMicrophoneAccess(nav)).toBe(false)
    })

    it('returns false when no media device API exists', async () => {
        expect(await requestMicrophoneAccess({mediaDevices: undefined} as unknown as MediaNav)).toBe(false)
    })
})
