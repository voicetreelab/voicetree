// Renderer-visible /events wire types — shared across the Electron-IPC
// boundary by Main (vtDaemonEventsClient + vtDaemonEventsBridge) and
// renderer (useEventSubscriptionConnection).
//
// Kept separate from eventSubscriptionHub.ts so that file stays server-only
// (it imports ws-frame machinery, queue limits, the publish/replay/overflow
// loop) — the renderer must never pull that in.
//
// `import type` only — no runtime side effects.

import type {TopicName} from './sse/eventSubscriptionHub.ts'

export type {TopicName}

export interface AgentLifecycleData {
    readonly terminalId: string
    readonly source: 'claude' | 'codex' | 'opencode'
    readonly at: number
    readonly [extra: string]: unknown
}

export interface EventFrame {
    readonly type: 'event'
    readonly topic: TopicName
    readonly seq: number
    readonly event: string
    readonly data: AgentLifecycleData
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
