import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectedGraph } from '@vt/graph-state/contract'

import {
    subscribeToDaemonSSE,
    unsubscribeFromDaemonSSE,
} from './daemon-sse-subscription'

type SentMessage = { channel: string; data: unknown }

function makeProjectedGraph(label: string): ProjectedGraph {
    return {
        nodes: [{
            id: `${label}.md`,
            kind: 'file',
            label,
            relPath: `${label}.md`,
            basename: `${label}.md`,
            folderPath: '/',
            content: label,
        }],
        edges: [],
        rootPath: '/',
        revision: 0,
        forests: [],
        arboricity: 0,
    }
}

function encodeSSE(graph: ProjectedGraph): Uint8Array {
    return new TextEncoder().encode(
        `event: projectedGraph\ndata: ${JSON.stringify(graph)}\n\n`,
    )
}

function makeMainWindow(sent: SentMessage[]): Electron.BrowserWindow {
    return {
        isDestroyed: () => false,
        webContents: {
            send(channel: string, data: unknown): void {
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
    afterEach(() => {
        unsubscribeFromDaemonSSE()
        vi.unstubAllGlobals()
    })

    it('forwards projected graph to renderer via IPC', async () => {
        const sent: SentMessage[] = []
        const graph: ProjectedGraph = makeProjectedGraph('external update')
        installFetchStream([encodeSSE(graph)])

        subscribeToDaemonSSE('renderer-session', 'http://127.0.0.1:3210', makeMainWindow(sent))

        await vi.waitFor(() => {
            expect(sent).toEqual([{ channel: 'graph:projectedGraphUpdate', data: graph }])
        })
    })

    it('forwards multiple SSE events', async () => {
        const sent: SentMessage[] = []
        const graph1: ProjectedGraph = makeProjectedGraph('first')
        const graph2: ProjectedGraph = makeProjectedGraph('second')
        installFetchStream([encodeSSE(graph1), encodeSSE(graph2)])

        subscribeToDaemonSSE('renderer-session', 'http://127.0.0.1:3210', makeMainWindow(sent))

        await vi.waitFor(() => {
            expect(sent).toHaveLength(2)
            expect(sent[0]).toEqual({ channel: 'graph:projectedGraphUpdate', data: graph1 })
            expect(sent[1]).toEqual({ channel: 'graph:projectedGraphUpdate', data: graph2 })
        })
    })
})
