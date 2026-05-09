import type { ProjectedGraph } from '@vt/graph-state/contract'

const SSE_SILENCE_TIMEOUT_MS: number = 45_000

let currentController: AbortController | null = null
let currentReconnectTimer: ReturnType<typeof setTimeout> | null = null
let currentSubscriptionKey: string | null = null
let lastSeenSeq: number = 0

function clearReconnectTimer(): void {
    if (currentReconnectTimer !== null) {
        clearTimeout(currentReconnectTimer)
        currentReconnectTimer = null
    }
}

function parseSSEBlock(block: string): ProjectedGraph | null {
    const dataLine: string | undefined = block
        .split('\n')
        .find((line: string) => line.startsWith('data:'))

    if (!dataLine) return null

    try {
        return JSON.parse(dataLine.slice('data:'.length).trim()) as ProjectedGraph
    } catch {
        return null
    }
}

function getProjectedGraphSeq(graph: ProjectedGraph): number | null {
    const seq: unknown = (graph as ProjectedGraph & { readonly seq?: unknown }).seq;
    return typeof seq === 'number' && Number.isFinite(seq) ? seq : null;
}

function forwardProjectedGraph(
    graph: ProjectedGraph,
    mainWindow: Electron.BrowserWindow,
): void {
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send('graph:projectedGraphUpdate', graph)
}

async function connectToDaemonSSE(
    sessionId: string,
    baseUrl: string,
    mainWindow: Electron.BrowserWindow,
    controller: AbortController,
): Promise<void> {
    const response: Response = await fetch(`${baseUrl}/sessions/${sessionId}/events?since=${lastSeenSeq}`, {
        signal: controller.signal,
    })

    if (!response.ok || !response.body) {
        throw new Error(`Daemon SSE subscription failed with status ${response.status}`)
    }

    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
    const decoder: TextDecoder = new TextDecoder()
    let buffered: string = ''

    while (!controller.signal.aborted) {
        let silenceTimer: ReturnType<typeof setTimeout> | null = null
        const timeout: Promise<null> = new Promise<null>((resolve) => {
            silenceTimer = setTimeout(() => resolve(null), SSE_SILENCE_TIMEOUT_MS)
            controller.signal.addEventListener('abort', () => {
                if (silenceTimer !== null) clearTimeout(silenceTimer)
            }, { once: true })
        })

        const result: ReadableStreamReadResult<Uint8Array> | null = await Promise.race([
            reader.read(),
            timeout,
        ])

        if (silenceTimer !== null) clearTimeout(silenceTimer)

        if (result === null) {
            reader.cancel().catch(() => {})
            return
        }

        if (result.done) break

        buffered += decoder.decode(result.value, { stream: true })
        const blocks: string[] = buffered.split('\n\n')
        buffered = blocks.pop() ?? ''

        for (const block of blocks) {
            const graph: ProjectedGraph | null = parseSSEBlock(block)
            if (graph) {
                const seq: number | null = getProjectedGraphSeq(graph);
                if (seq !== null) {
                    lastSeenSeq = Math.max(lastSeenSeq, seq);
                }
                forwardProjectedGraph(graph, mainWindow)
            }
        }
    }
}

function scheduleReconnect(
    sessionId: string,
    baseUrl: string,
    mainWindow: Electron.BrowserWindow,
    controller: AbortController,
): void {
    if (controller.signal.aborted || currentController !== controller) return

    clearReconnectTimer()
    currentReconnectTimer = setTimeout(() => {
        if (controller.signal.aborted || currentController !== controller) return
        subscribeToDaemonSSE(sessionId, baseUrl, mainWindow)
    }, 3_000)
}

let lockedForTest: boolean = false

export function subscribeToDaemonSSE(
    sessionId: string,
    baseUrl: string,
    mainWindow: Electron.BrowserWindow,
): void {
    if (lockedForTest) return
    unsubscribeFromDaemonSSE()

    const subscriptionKey: string = `${baseUrl}|${sessionId}`;
    if (currentSubscriptionKey !== subscriptionKey) {
        currentSubscriptionKey = subscriptionKey;
        lastSeenSeq = 0;
    }

    const controller: AbortController = new AbortController()
    currentController = controller

    void connectToDaemonSSE(sessionId, baseUrl, mainWindow, controller)
        .then(() => {
            if (!controller.signal.aborted && currentController === controller) {
                scheduleReconnect(sessionId, baseUrl, mainWindow, controller)
            }
        })
        .catch((error: unknown) => {
            if (controller.signal.aborted || currentController !== controller) return
            console.warn('Daemon SSE stream error; reconnecting', error)
            scheduleReconnect(sessionId, baseUrl, mainWindow, controller)
        })
}

export function unsubscribeFromDaemonSSE(): void {
    clearReconnectTimer()
    currentController?.abort()
    currentController = null
}

export function isDaemonSSEActive(): boolean {
    return currentController !== null && !currentController.signal.aborted
}

export function __debugLockSSE(): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('Test-only API')
    unsubscribeFromDaemonSSE()
    lockedForTest = true
}

export function __debugUnlockSSE(): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('Test-only API')
    lockedForTest = false
}
