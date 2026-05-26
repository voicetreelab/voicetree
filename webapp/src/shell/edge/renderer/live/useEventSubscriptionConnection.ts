/**
 * React hook owning the renderer's /events subscription for the mounting
 * component's lifetime. `isConnected` gates renderer mutations (point 7 of
 * the 9e brief).
 */
import { useEffect, useState } from 'react'
import { connectVaultStateSubscription } from './connectVaultStateSubscription'
import type { ConnectionState, EventFrame, Topic } from './eventSubscription'

const DEFAULT_TOPICS: readonly Topic[] = ['vault-state', 'agent-events']

export interface EventSubscriptionConnectionState {
    readonly state: ConnectionState
    readonly isConnected: boolean
}

export function useEventSubscriptionConnection(options: {
    readonly topics?: readonly Topic[]
    readonly onEvent?: (frame: EventFrame) => void
    readonly onResnapshot?: (topic: Topic) => void
} = {}): EventSubscriptionConnectionState {
    const [state, setState] = useState<ConnectionState>({ kind: 'closed' })

    useEffect(() => {
        if (typeof window === 'undefined' || !window.electronAPI) return
        const handle = connectVaultStateSubscription(options.topics ?? DEFAULT_TOPICS, {
            onEvent: options.onEvent ?? ((): void => {}),
            onResnapshot: options.onResnapshot ?? ((): void => {}),
            onConnectionState: setState,
        })
        return () => handle.close()
        // Subscription is owned by the component instance — re-running on
        // new option identities would tear down the WS on every parent
        // re-render. Callers wanting different topics should remount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return { state, isConnected: state.kind === 'connected' }
}
