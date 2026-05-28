/**
 * Black-box tests for useEventSubscriptionConnection. The mock surface is
 * `window.electronAPI.events`, which IS the preload-injected API boundary
 * (per CLAUDE.md: "mock at the API boundary, not internal collaborators").
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {act, renderHook} from '@testing-library/react'
import type {ConnectionState, EventFrame, GapFrame, TopicName} from '@vt/vt-daemon/transport/eventTypes'
import {useEventSubscriptionConnection} from './useEventSubscriptionConnection'

interface FrameListener { readonly topic: TopicName; readonly fn: (frame: EventFrame | GapFrame) => void }
interface StubEventsAPI {
    readonly frameListeners: FrameListener[]
    readonly stateListeners: Array<(state: ConnectionState) => void>
    readonly frameUnsubscribeCount: () => number
    readonly stateUnsubscribeCount: () => number
}

function installStubElectronAPI(): StubEventsAPI {
    const frameListeners: FrameListener[] = []
    const stateListeners: Array<(state: ConnectionState) => void> = []
    let frameUnsub: number = 0
    let stateUnsub: number = 0

    const electronAPI = {
        events: {
            on: (topic: TopicName, fn: (frame: EventFrame | GapFrame) => void): (() => void) => {
                const entry: FrameListener = {topic, fn}
                frameListeners.push(entry)
                return (): void => {
                    const idx = frameListeners.indexOf(entry)
                    if (idx >= 0) frameListeners.splice(idx, 1)
                    frameUnsub += 1
                }
            },
            onConnectionState: (fn: (state: ConnectionState) => void): (() => void) => {
                stateListeners.push(fn)
                return (): void => {
                    const idx = stateListeners.indexOf(fn)
                    if (idx >= 0) stateListeners.splice(idx, 1)
                    stateUnsub += 1
                }
            },
            resnapshot: (_topic: TopicName): Promise<void> => Promise.resolve(),
        },
    }
    Object.defineProperty(window, 'electronAPI', {
        value: electronAPI,
        configurable: true,
        writable: true,
    })

    return {
        frameListeners,
        stateListeners,
        frameUnsubscribeCount: (): number => frameUnsub,
        stateUnsubscribeCount: (): number => stateUnsub,
    }
}

describe('useEventSubscriptionConnection', (): void => {
    let stub: StubEventsAPI

    beforeEach((): void => {
        stub = installStubElectronAPI()
    })

    afterEach((): void => {
        delete (window as {electronAPI?: unknown}).electronAPI
    })

    it('returns isConnected=true after onConnectionState fires {kind:"connected"}', (): void => {
        const {result} = renderHook(() => useEventSubscriptionConnection())
        expect(result.current.isConnected).toBe(false)

        act((): void => {
            for (const listener of stub.stateListeners) listener({kind: 'connected'})
        })

        expect(result.current.isConnected).toBe(true)
        expect(result.current.state.kind).toBe('connected')
    })

    it('delivers event frames to onEvent callback', (): void => {
        const received: EventFrame[] = []
        renderHook(() => useEventSubscriptionConnection({onEvent: (f) => { received.push(f) }}))

        const frame: EventFrame = {
            type: 'event', topic: 'agent-lifecycle', seq: 1, event: 'agent-spawned',
            data: {terminalId: 'T1', source: 'claude', at: 0},
        }
        act((): void => {
            for (const l of stub.frameListeners) l.fn(frame)
        })
        expect(received).toEqual([frame])
    })

    it('routes gap frames to onResnapshot callback (not onEvent)', (): void => {
        const events: EventFrame[] = []
        const resnapshots: TopicName[] = []
        renderHook(() => useEventSubscriptionConnection({
            onEvent: (f) => { events.push(f) },
            onResnapshot: (t) => { resnapshots.push(t) },
        }))

        const gap: GapFrame = {type: 'gap', topic: 'agent-lifecycle', fromSeq: 5, currentSeq: 42}
        act((): void => {
            for (const l of stub.frameListeners) l.fn(gap)
        })
        expect(events).toEqual([])
        expect(resnapshots).toEqual(['agent-lifecycle'])
    })

    it('unmount calls both unsubscribe functions (no listener leak across remounts)', (): void => {
        const {unmount} = renderHook(() => useEventSubscriptionConnection())
        expect(stub.frameListeners.length).toBe(1)
        expect(stub.stateListeners.length).toBe(1)

        unmount()
        expect(stub.frameUnsubscribeCount()).toBe(1)
        expect(stub.stateUnsubscribeCount()).toBe(1)
        expect(stub.frameListeners.length).toBe(0)
        expect(stub.stateListeners.length).toBe(0)

        // A fresh mount installs a fresh pair (no doubling, no leak).
        const second = renderHook(() => useEventSubscriptionConnection())
        expect(stub.frameListeners.length).toBe(1)
        expect(stub.stateListeners.length).toBe(1)
        second.unmount()
        expect(stub.frameListeners.length).toBe(0)
        expect(stub.stateListeners.length).toBe(0)
    })
})
