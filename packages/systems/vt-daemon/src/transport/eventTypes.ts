// Renderer-visible /events wire types — shared across the Electron-IPC
// boundary by Main (vtDaemonEventsClient + vtDaemonEventsBridge) and
// renderer (useEventSubscriptionConnection).
//
// Kept separate from eventSubscriptionHub.ts so that file stays server-only
// (it imports ws-frame machinery, queue limits, the publish/replay/overflow
// loop) — the renderer must never pull that in.
//
// `import type` only — no runtime side effects.

import type {ProjectedGraph} from '@vt/graph-state/contract'
import type {TerminalRegistryEvent} from '@vt/vt-daemon-protocol'
import type {TopicName} from './sse/eventSubscriptionHub.ts'

export type {TopicName}

/**
 * Renderer-visible /events frame, discriminated on `topic` so each topic
 * carries its own `data` shape (RE-PLAN B). A consumer that already filters by
 * topic (`events.on(topic, …)`) narrows type-safely instead of casting:
 *   - `graph`             → full `ProjectedGraph` snapshots (event `projectedGraph`)
 *   - `terminal-registry` → registry mutations (`TerminalRegistryEvent`)
 */
export type EventFrame =
    | {
        readonly type: 'event'
        readonly topic: 'graph'
        readonly seq: number
        readonly event: 'projectedGraph'
        readonly data: ProjectedGraph
    }
    | {
        readonly type: 'event'
        readonly topic: 'terminal-registry'
        readonly seq: number
        readonly event: string
        readonly data: TerminalRegistryEvent
    }

export interface GapFrame {
    readonly type: 'gap'
    readonly topic: TopicName
    readonly fromSeq: number
    readonly currentSeq: number
}

export type ConnectionState =
    | {readonly kind: 'connecting'; readonly attempt: number}
    | {readonly kind: 'connected'}
    | {readonly kind: 'reconnecting'; readonly attempt: number; readonly delayMs: number}
    | {readonly kind: 'closed'}
