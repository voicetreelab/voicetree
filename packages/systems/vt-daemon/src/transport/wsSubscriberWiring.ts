// Subscriber-side WebSocket lifecycle for the /events route. Each connected
// client becomes an EventSubscriptionHub subscriber:
//   - inbound JSON frames {op: 'subscribe' | 'unsubscribe', topics: [...]}
//     mutate the subscription set
//   - outbound frames are forwarded via ws.send when the socket is OPEN
//   - hub-side overflow (1 MiB / 1000 frames, design doc §2.6) closes 1011
//   - inbound frames over 256 KiB trip the WebSocketServer maxPayload (close
//     1009, §8.6) before reaching this wiring
//
// Extracted from httpServer.ts as a pure refactor (no behavior change) to
// keep httpServer.ts under the 500-line repo-wide ceiling enforced by the
// PostToolUse file-size hook.

import type {RawData, WebSocket} from 'ws'

import {
    isTopicName,
    type EventSubscriptionHub,
    type SubscribeRequest,
    type Subscriber,
    type SubscriberHandle,
    type TopicName,
} from './sse/eventSubscriptionHub.ts'

interface WsSubscriberContext {
    readonly handle: SubscriberHandle
    readonly ws: WebSocket
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSubscribeRequests(value: unknown): SubscribeRequest[] {
    if (!Array.isArray(value)) return []
    const out: SubscribeRequest[] = []
    for (const item of value) {
        if (!isRecord(item)) continue
        if (!isTopicName(item.topic)) continue
        const resumeSeq: number | undefined = typeof item.resumeSeq === 'number' ? item.resumeSeq : undefined
        out.push({topic: item.topic, resumeSeq})
    }
    return out
}

function parseUnsubscribeTopics(value: unknown): TopicName[] {
    if (!Array.isArray(value)) return []
    const out: TopicName[] = []
    for (const item of value) {
        if (isTopicName(item)) out.push(item)
    }
    return out
}

function handleClientFrame(ctx: WsSubscriberContext, raw: RawData): void {
    const text: string = raw.toString()
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return
    }
    if (!isRecord(parsed)) return
    if (parsed.op === 'subscribe') {
        ctx.handle.subscribe(parseSubscribeRequests(parsed.topics))
    } else if (parsed.op === 'unsubscribe') {
        ctx.handle.unsubscribe(parseUnsubscribeTopics(parsed.topics))
    }
}

export function wireWebSocketSubscriber(ws: WebSocket, hub: EventSubscriptionHub): void {
    const subscriber: Subscriber = {
        send: (frame: string): void => {
            if (ws.readyState === ws.OPEN) ws.send(frame)
        },
        overflow: (): void => {
            try { ws.close(1011, 'overflow') } catch { /* socket may already be torn down */ }
        },
    }
    const handle: SubscriberHandle = hub.addSubscriber(subscriber)
    const ctx: WsSubscriberContext = {handle, ws}

    ws.on('message', (raw: RawData): void => handleClientFrame(ctx, raw))
    ws.on('close', (): void => handle.close())
    ws.on('error', (): void => handle.close())
}
