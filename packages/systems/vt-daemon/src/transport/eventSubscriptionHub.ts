// Per-topic monotonic-seq pubsub with a bounded resume buffer and a
// per-subscriber bounded outbound queue. Post-Phase-0 + Phase-2 topics:
// `agent-events` (hook ingestion — renamed from agent-lifecycle in
// BF-376) and `terminal-registry` (BF-376 outbound — registry mutations
// + imperative UI-launch instructions). The pre-Phase-0 `vault-state`
// topic was deleted by BF-366; the single FS-watcher invariant lives in
// vt-graphd. Per BF-376 design decision 2 (outbound design.md §6),
// terminal-registry is its own narrow homogeneous topic, NOT a widening
// of the agent-events envelope.
//
// Wire envelopes (text frames on the WS):
//   server→client: { type: 'event', topic, seq, event, data }
//   server→client: { type: 'gap',   topic, fromSeq, currentSeq }
//   client→server: { op: 'subscribe',   topics: [ { topic, resumeSeq? }, … ] }
//   client→server: { op: 'unsubscribe', topics: [ string, … ] }
//
// The hub is transport-agnostic: it knows nothing about WebSocket. The
// httpServer layer wraps each subscriber's send fn around the WS connection
// and uses overflow() to close with WS code 1011.

import type {TerminalRegistryTopic} from '@vt/vt-daemon-protocol'

// The protocol package owns the topic-name TYPE; the daemon spells the
// runtime literal here. The type annotation makes TypeScript reject any
// drift from the canonical 'terminal-registry' string in the protocol.
export const TERMINAL_REGISTRY_TOPIC: TerminalRegistryTopic = 'terminal-registry'

export type TopicName = 'agent-events' | TerminalRegistryTopic

export const ALLOWED_TOPICS: readonly TopicName[] = ['agent-events', TERMINAL_REGISTRY_TOPIC]

const RESUME_BUFFER_SIZE: number = 100
const PER_SUBSCRIBER_QUEUE_LIMIT: number = 1000
const PER_SUBSCRIBER_BYTE_LIMIT: number = 1 * 1024 * 1024

export interface PublishedEvent {
    readonly topic: TopicName
    readonly seq: number
    readonly event: string
    readonly data: unknown
}

interface BufferedEvent extends PublishedEvent {
    readonly serialized: string
}

export type ServerFrame =
    | {readonly type: 'event'; readonly topic: TopicName; readonly seq: number; readonly event: string; readonly data: unknown}
    | {readonly type: 'gap'; readonly topic: TopicName; readonly fromSeq: number; readonly currentSeq: number}

interface TopicState {
    nextSeq: number
    readonly buffer: BufferedEvent[]
}

export interface Subscriber {
    readonly send: (frame: string) => void
    readonly overflow: () => void
}

interface SubscriberState {
    readonly subscriber: Subscriber
    readonly topics: Set<TopicName>
    queuedBytes: number
    queuedFrames: number
    closed: boolean
}

export interface SubscribeRequest {
    readonly topic: TopicName
    readonly resumeSeq?: number
}

export interface EventSubscriptionHub {
    readonly publish: (topic: TopicName, event: string, data: unknown) => void
    readonly addSubscriber: (subscriber: Subscriber) => SubscriberHandle
    readonly currentSeq: (topic: TopicName) => number
    readonly subscriberCount: () => number
}

export interface SubscriberHandle {
    readonly subscribe: (requests: readonly SubscribeRequest[]) => void
    readonly unsubscribe: (topics: readonly TopicName[]) => void
    readonly close: () => void
}

export function isTopicName(value: unknown): value is TopicName {
    return typeof value === 'string' && (ALLOWED_TOPICS as readonly string[]).includes(value)
}

function serializeFrame(frame: ServerFrame): string {
    return JSON.stringify(frame)
}

function appendBuffered(state: TopicState, frame: BufferedEvent): void {
    state.buffer.push(frame)
    if (state.buffer.length > RESUME_BUFFER_SIZE) {
        state.buffer.splice(0, state.buffer.length - RESUME_BUFFER_SIZE)
    }
}

function findBufferedAt(state: TopicState, seq: number): BufferedEvent | null {
    for (let i: number = 0; i < state.buffer.length; i++) {
        if (state.buffer[i].seq === seq) return state.buffer[i]
    }
    return null
}

function enqueueSubscriber(sub: SubscriberState, frame: string): boolean {
    if (sub.closed) return false
    if (
        sub.queuedFrames + 1 > PER_SUBSCRIBER_QUEUE_LIMIT
        || sub.queuedBytes + frame.length > PER_SUBSCRIBER_BYTE_LIMIT
    ) {
        sub.closed = true
        sub.subscriber.overflow()
        return false
    }
    sub.queuedFrames += 1
    sub.queuedBytes += frame.length
    try {
        sub.subscriber.send(frame)
    } catch {
        sub.closed = true
        return false
    }
    sub.queuedFrames -= 1
    sub.queuedBytes -= frame.length
    return true
}

export function createEventSubscriptionHub(): EventSubscriptionHub {
    const topics: Map<TopicName, TopicState> = new Map<TopicName, TopicState>()
    const subscribers: Set<SubscriberState> = new Set<SubscriberState>()

    for (const topic of ALLOWED_TOPICS) {
        topics.set(topic, {nextSeq: 1, buffer: []})
    }

    function publish(topic: TopicName, event: string, data: unknown): void {
        const state: TopicState | undefined = topics.get(topic)
        if (!state) {
            throw new Error(`publish: unknown topic ${topic}`)
        }
        const seq: number = state.nextSeq
        state.nextSeq += 1
        const serialized: string = serializeFrame({type: 'event', topic, seq, event, data})
        appendBuffered(state, {topic, seq, event, data, serialized})

        for (const sub of subscribers) {
            if (!sub.topics.has(topic) || sub.closed) continue
            enqueueSubscriber(sub, serialized)
        }
    }

    function replayResume(sub: SubscriberState, request: SubscribeRequest): void {
        if (request.resumeSeq === undefined || request.resumeSeq <= 0) return
        const state: TopicState | undefined = topics.get(request.topic)
        if (!state) return
        const currentSeq: number = state.nextSeq - 1
        const fromSeq: number = request.resumeSeq

        if (fromSeq > currentSeq) return // client ahead of us → nothing to replay

        const fromBuffered: BufferedEvent | null = findBufferedAt(state, fromSeq)
        if (!fromBuffered) {
            const gap: string = serializeFrame({type: 'gap', topic: request.topic, fromSeq, currentSeq})
            enqueueSubscriber(sub, gap)
            return
        }
        for (const buffered of state.buffer) {
            if (buffered.seq >= fromSeq) {
                if (!enqueueSubscriber(sub, buffered.serialized)) return
            }
        }
    }

    function addSubscriber(subscriber: Subscriber): SubscriberHandle {
        const state: SubscriberState = {
            subscriber,
            topics: new Set<TopicName>(),
            queuedBytes: 0,
            queuedFrames: 0,
            closed: false,
        }
        subscribers.add(state)

        return {
            subscribe: (requests: readonly SubscribeRequest[]): void => {
                if (state.closed) return
                for (const request of requests) {
                    if (!isTopicName(request.topic)) continue
                    state.topics.add(request.topic)
                    replayResume(state, request)
                }
            },
            unsubscribe: (topicsToDrop: readonly TopicName[]): void => {
                for (const topic of topicsToDrop) {
                    state.topics.delete(topic)
                }
            },
            close: (): void => {
                state.closed = true
                subscribers.delete(state)
            },
        }
    }

    return {
        publish,
        addSubscriber,
        currentSeq: (topic: TopicName): number => {
            const state: TopicState | undefined = topics.get(topic)
            return state ? state.nextSeq - 1 : 0
        },
        subscriberCount: (): number => subscribers.size,
    }
}
