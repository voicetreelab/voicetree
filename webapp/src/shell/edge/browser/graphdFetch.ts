// Typed graphd REST client for browser use.
// Graphd has no auth (loopback-only) so no Authorization header is needed.
// All calls include X-Session-Id when a session is active.

import type {ProjectedGraph} from '@vt/graph-state/contract'
import type {Graph, GraphDelta} from '@vt/graph-model/graph'
import type {ProjectState} from '@vt/graph-db-protocol'

export type GraphdClientConfig = {
    readonly graphdUrl: string
    readonly getSessionId: () => string | null
}

async function gfetch(
    graphdUrl: string,
    path: string,
    opts: RequestInit = {},
    sessionId?: string | null,
): Promise<Response> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(opts.headers as Record<string, string> ?? {}),
    }
    if (sessionId) headers['X-Session-Id'] = sessionId
    const res = await fetch(`${graphdUrl}${path}`, {...opts, headers})
    if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`graphd ${opts.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 200)}`)
    }
    return res
}

export async function graphdGetProject(graphdUrl: string): Promise<ProjectState> {
    const res = await gfetch(graphdUrl, '/project')
    return res.json() as Promise<ProjectState>
}

export async function graphdGetGraph(graphdUrl: string): Promise<Graph> {
    const res = await gfetch(graphdUrl, '/graph')
    return res.json() as Promise<Graph>
}

export async function graphdCreateSession(graphdUrl: string): Promise<{sessionId: string}> {
    const res = await gfetch(graphdUrl, '/sessions', {method: 'POST'})
    return res.json() as Promise<{sessionId: string}>
}

export async function graphdGetProjectedGraph(graphdUrl: string, sessionId: string): Promise<ProjectedGraph> {
    const res = await gfetch(graphdUrl, `/sessions/${sessionId}/projected-graph`, {}, sessionId)
    return res.json() as Promise<ProjectedGraph>
}

export async function graphdApplyDelta(
    graphdUrl: string,
    sessionId: string,
    delta: GraphDelta,
    recordForUndo = true,
): Promise<void> {
    // graphd /graph/apply-delta expects {delta: [...], recordForUndo?: boolean}
    await gfetch(graphdUrl, '/graph/apply-delta', {
        method: 'POST',
        body: JSON.stringify({delta, recordForUndo}),
    }, sessionId)
}

export async function graphdWriteMarkdownFile(
    graphdUrl: string,
    sessionId: string,
    absolutePath: string,
    body: string,
    editorId: string,
): Promise<{ok: true; absolutePath: string; preservedSuffix: string | null}> {
    // graphd expects {absolutePath, body, editorId}
    const res = await gfetch(graphdUrl, '/graph/write-markdown-file', {
        method: 'POST',
        body: JSON.stringify({absolutePath, body, editorId}),
    }, sessionId)
    return res.json() as Promise<{ok: true; absolutePath: string; preservedSuffix: string | null}>
}

export async function graphdGetNode(graphdUrl: string, nodeId: string): Promise<unknown> {
    const res = await gfetch(graphdUrl, `/graph?nodeId=${encodeURIComponent(nodeId)}`)
    const graph = await res.json() as Graph
    return graph.nodes[nodeId] ?? null
}

export async function graphdFindFile(graphdUrl: string, filename: string): Promise<unknown> {
    const res = await gfetch(graphdUrl, `/graph/find-file?filename=${encodeURIComponent(filename)}`)
    return res.json()
}

export async function graphdCreateContextNode(graphdUrl: string, sessionId: string, payload: unknown): Promise<unknown> {
    const res = await gfetch(graphdUrl, '/graph/context-node', {
        method: 'POST',
        body: JSON.stringify(payload),
    }, sessionId)
    return res.json()
}

export async function graphdUndo(graphdUrl: string, sessionId: string): Promise<unknown> {
    const res = await gfetch(graphdUrl, '/graph/undo', {method: 'POST', body: '{}'}, sessionId)
    return res.json()
}

export async function graphdRedo(graphdUrl: string, sessionId: string): Promise<unknown> {
    const res = await gfetch(graphdUrl, '/graph/redo', {method: 'POST', body: '{}'}, sessionId)
    return res.json()
}

export async function graphdSavePositions(graphdUrl: string, sessionId: string, payload: unknown): Promise<void> {
    await gfetch(graphdUrl, '/graph/write-positions', {
        method: 'POST',
        body: JSON.stringify(payload),
    }, sessionId)
}

/** Subscribe to graphd SSE session events. Returns a cleanup function. */
export function graphdSubscribeSessionEvents(
    graphdUrl: string,
    sessionId: string,
    onEvent: (data: string) => void,
    onError: (err: unknown) => void,
    sinceSeq = 0,
): () => void {
    const abortController = new AbortController()
    void (async () => {
        try {
            const res = await fetch(
                `${graphdUrl}/sessions/${sessionId}/events?since=${sinceSeq}`,
                {signal: abortController.signal},
            )
            if (!res.ok || !res.body) throw new Error(`SSE open failed: ${res.status}`)
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buf = ''
            while (true) {
                const {done, value} = await reader.read()
                if (done) break
                buf += decoder.decode(value, {stream: true})
                const lines = buf.split('\n')
                buf = lines.pop() ?? ''
                for (const line of lines) {
                    if (line.startsWith('data: ')) onEvent(line.slice(6))
                }
            }
        } catch (err) {
            if ((err as {name?: string}).name !== 'AbortError') onError(err)
        }
    })()
    return () => abortController.abort()
}
