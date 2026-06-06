// Per-topic monotonic-seq pubsub with a bounded resume buffer and a
// per-subscriber bounded outbound queue. Live topics: `graph` (full
// ProjectedGraph snapshots) and `terminal-registry` (BF-376 outbound —
// registry mutations + imperative UI-launch instructions). The pre-Phase-0
// `project-state` topic was deleted by BF-366; the single FS-watcher
// invariant lives in vt-graphd. Per BF-376 design decision 2 (outbound
// design.md §6), terminal-registry is its own narrow homogeneous topic.
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

export type TopicName = 'graph' | TerminalRegistryTopic

export const ALLOWED_TOPICS: readonly TopicName[] = ['graph', TERMINAL_REGISTRY_TOPIC]

/**
 * Topics whose payloads are idempotent full-replace snapshots, delivered with
 * LATEST-WINS CONFLATION instead of exact replay (RE-PLAN B). The `graph` topic
 * carries full `ProjectedGraph` snapshots (large + frequent); a slow subscriber
 * keeps only the newest unsent snapshot rather than queuing every intermediate,
 * so it is never force-closed for overflow. The exact-replay `terminal-registry`
 * topic is NOT here — its consumers need every event in order.
 */
const CONFLATING_TOPICS: ReadonlySet<TopicName> = new Set<TopicName>(['graph'])

const RESUME_BUFFER_SIZE: number = 100
// Conflating topics keep only the latest snapshot for resume: a reconnecting
// subscriber that is behind gets a gap frame and re-snapshots, which is the
// idempotent full-replace semantics anyway — buffering 100 large snapshots
// would waste memory for no gain.
const CONFLATING_RESUME_BUFFER_SIZE: number = 1
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
    /**
     * Deliver one frame. `onSent` (when provided) MUST be invoked once the
     * frame has flushed to the underlying transport — it drives latest-wins
     * conflation for snapshot topics. A subscriber that subscribes to a
     * conflating topic (see `CONFLATING_TOPICS`) MUST honour `onSent`, else the
     * conflation pump stalls; exact-replay subscribers may ignore it.
     */
    readonly send: (frame: string, onSent?: () => void) => void
    readonly overflow: () => void
}

/** Per-conflating-topic delivery slot: at most one in-flight send + the newest unsent frame. */
interface ConflateSlot {
    pending: string | null
    inFlight: boolean
}

interface SubscriberState {
    readonly subscriber: Subscriber
    readonly topics: Set<TopicName>
    readonly conflate: Map<TopicName, ConflateSlot>
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

function appendBuffered(state: TopicState, frame: BufferedEvent, maxSize: number): void {
    state.buffer.push(frame)
    if (state.buffer.length > maxSize) {
        state.buffer.splice(0, state.buffer.length - maxSize)
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

/**
 * Deliver a conflating-topic frame with latest-wins semantics. While a send is
 * in flight (the transport is draining), newer snapshots overwrite the single
 * `pending` slot rather than queuing — when the in-flight send completes,
 * only the newest pending frame is sent. No byte/frame accounting, so a slow
 * subscriber is never force-closed: it simply skips stale intermediate
 * snapshots, which is sound because each snapshot is a full idempotent replace.
 */
function publishConflated(sub: SubscriberState, topic: TopicName, frame: string): void {
    let slot: ConflateSlot | undefined = sub.conflate.get(topic)
    if (!slot) {
        slot = {pending: null, inFlight: false}
        sub.conflate.set(topic, slot)
    }
    if (slot.inFlight) {
        slot.pending = frame // latest wins — drop the previous unsent snapshot
        return
    }
    slot.inFlight = true
    drainConflated(sub, slot, frame)
}

function drainConflated(sub: SubscriberState, slot: ConflateSlot, frame: string): void {
    if (sub.closed) {
        slot.inFlight = false
        return
    }
    const onSent = (): void => {
        if (sub.closed) {
            slot.inFlight = false
            return
        }
        if (slot.pending !== null) {
            const next: string = slot.pending
            slot.pending = null
            drainConflated(sub, slot, next)
        } else {
            slot.inFlight = false
        }
    }
    try {
        sub.subscriber.send(frame, onSent)
    } catch {
        sub.closed = true
    }
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
        const conflating: boolean = CONFLATING_TOPICS.has(topic)
        appendBuffered(
            state,
            {topic, seq, event, data, serialized},
            conflating ? CONFLATING_RESUME_BUFFER_SIZE : RESUME_BUFFER_SIZE,
        )

        for (const sub of subscribers) {
            if (!sub.topics.has(topic) || sub.closed) continue
            if (conflating) publishConflated(sub, topic, serialized)
            else enqueueSubscriber(sub, serialized)
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
            conflate: new Map<TopicName, ConflateSlot>(),
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
