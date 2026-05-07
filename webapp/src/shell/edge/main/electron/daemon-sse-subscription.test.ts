import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { GraphDelta } from '@vt/graph-model/pure/graph'

const { daemonEditorUpdates } = vi.hoisted(() => ({
    daemonEditorUpdates: [] as GraphDelta[],
}))

vi.mock('@/shell/edge/main/ui-api-proxy', () => ({
    uiAPI: {
        updateFloatingEditorsFromDaemon(delta: GraphDelta): void {
            daemonEditorUpdates.push(delta)
        },
    },
}))

import {
    subscribeToDaemonSSE,
    unsubscribeFromDaemonSSE,
} from './daemon-sse-subscription'

type SentMessage = { channel: string; data: GraphDelta }

function makeDelta(content: string): GraphDelta {
    return [{
        type: 'UpsertNode',
        nodeToUpsert: {
            kind: 'leaf',
            absoluteFilePathIsID: `${content}.md`,
            contentWithoutYamlOrLinks: content,
            outgoingEdges: [],
            nodeUIMetadata: {
                color: O.none,
                position: O.none,
                additionalYAMLProps: new Map(),
            },
        },
        previousNode: O.none,
    }]
}

function encodeSSE(source: string, delta: GraphDelta): Uint8Array {
    return new TextEncoder().encode(
        `event: graphDelta\ndata: ${JSON.stringify({ source, delta }, (_key, value) => {
            if (value instanceof Map) {
                return Object.fromEntries(value.entries())
            }
            return value
        })}\n\n`,
    )
}

function makeMainWindow(sent: SentMessage[]): Electron.BrowserWindow {
    return {
        isDestroyed: () => false,
        webContents: {
            send(channel: string, data: GraphDelta): void {
                sent.push({ channel, data })
            },
        },
    } as unknown as Electron.BrowserWindow
}

function installFetchStream(chunks: Uint8Array[]): void {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
        new ReadableStream<Uint8Array>({
            start(controller): void {
                for (const chunk of chunks) {
                    controller.enqueue(chunk)
                }
                controller.close()
            },
        }),
        { status: 200 },
    )))
}

describe('daemon SSE subscription', () => {
    beforeEach(() => {
        daemonEditorUpdates.length = 0
    })

    afterEach(() => {
        unsubscribeFromDaemonSSE()
        vi.unstubAllGlobals()
    })

    it('forwards all deltas to graph IPC and daemon editor updates', async () => {
        const sent: SentMessage[] = []
        const externalDelta: GraphDelta = makeDelta('external update')
        const expectedDelta: GraphDelta = JSON.parse(JSON.stringify(externalDelta)) as GraphDelta
        installFetchStream([
            encodeSSE('fs:external', externalDelta),
        ])

        subscribeToDaemonSSE('renderer-session', 'http://127.0.0.1:3210', makeMainWindow(sent))

        await vi.waitFor(() => {
            expect(sent).toEqual([{ channel: 'graph:stateChanged', data: expectedDelta }])
            expect(daemonEditorUpdates).toEqual([expectedDelta])
        })
    })

    it('forwards own-session deltas without filtering', async () => {
        const sent: SentMessage[] = []
        const ownDelta: GraphDelta = makeDelta('own write')
        const expectedDelta: GraphDelta = JSON.parse(JSON.stringify(ownDelta)) as GraphDelta
        installFetchStream([
            encodeSSE('session:renderer-session', ownDelta),
        ])

        subscribeToDaemonSSE('renderer-session', 'http://127.0.0.1:3210', makeMainWindow(sent))

        await vi.waitFor(() => {
            expect(sent).toEqual([{ channel: 'graph:stateChanged', data: expectedDelta }])
        })
    })

})
