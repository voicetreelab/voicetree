/**
 * React hook subscribing the mounting component to VTD /events frames over
 * Electron IPC. Main owns the WebSocket; this hook is a thin wrapper around
 * the preload-injected `electronAPI.events` surface (Phase 0 / BF-367).
 *
 * `isConnected` gates renderer mutations (point 7 of the 9e brief).
 *
 * Subscription is component-lifetime: subscribe on mount, unsubscribe on
 * unmount. Options identity is intentionally ignored (no re-subscription on
 * parent re-render). Callers that need different filters remount.
 */
import {useEffect, useState} from 'react'
import type {ConnectionState, EventFrame, GapFrame, TopicName} from '@vt/vt-daemon/transport/eventTypes'

const DEFAULT_TOPIC: TopicName = 'agent-events'

export interface EventSubscriptionConnectionState {
    readonly state: ConnectionState
    readonly isConnected: boolean
}

export interface UseEventSubscriptionConnectionOptions {
    readonly topic?: TopicName
    readonly onEvent?: (frame: EventFrame) => void
    readonly onResnapshot?: (topic: TopicName) => void
}

export function useEventSubscriptionConnection(
    options: UseEventSubscriptionConnectionOptions = {},
): EventSubscriptionConnectionState {
    const [state, setState] = useState<ConnectionState>({kind: 'closed'})

    useEffect((): (() => void) | undefined => {
        if (typeof window === 'undefined' || !window.electronAPI) return undefined
        const api = window.electronAPI
        const topic: TopicName = options.topic ?? DEFAULT_TOPIC
        const onEvent: (frame: EventFrame) => void = options.onEvent ?? ((): void => {})
        const onResnapshot: (topic: TopicName) => void = options.onResnapshot ?? ((): void => {})

        const offFrame: () => void = api.events.on(topic, (frame: EventFrame | GapFrame): void => {
            if (frame.type === 'event') onEvent(frame)
            else onResnapshot(frame.topic)
        })
        const offState: () => void = api.events.onConnectionState(setState)

        return (): void => {
            offFrame()
            offState()
        }
        // Subscription is owned by the component instance — re-running on
        // option-identity churn would tear the IPC listeners down on every
        // parent re-render. Callers wanting different filters should remount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return {state, isConnected: state.kind === 'connected'}
}
