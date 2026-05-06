import type { GraphDelta } from '@vt/graph-model/pure/graph'

type SourceTaggedDelta = {
    delta: GraphDelta
    source: string
}

let currentController: AbortController | null = null
let currentReconnectTimer: ReturnType<typeof setTimeout> | null = null

function clearReconnectTimer(): void {
    if (currentReconnectTimer !== null) {
        clearTimeout(currentReconnectTimer)
        currentReconnectTimer = null
    }
}

function parseSSEBlock(block: string): SourceTaggedDelta | null {
    const dataLine: string | undefined = block
        .split('\n')
        .find((line: string) => line.startsWith('data:'))

    if (!dataLine) return null

    try {
        return JSON.parse(dataLine.slice('data:'.length).trim()) as SourceTaggedDelta
    } catch {
        return null
    }
}

function forwardDelta(
    event: SourceTaggedDelta,
    mainWindow: Electron.BrowserWindow,
): void {
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send('graph:stateChanged', event.delta)
}

async function connectToDaemonSSE(
    sessionId: string,
    baseUrl: string,
    mainWindow: Electron.BrowserWindow,
    controller: AbortController,
): Promise<void> {
    const response: Response = await fetch(`${baseUrl}/sessions/${sessionId}/events`, {
        signal: controller.signal,
    })

    if (!response.ok || !response.body) {
        throw new Error(`Daemon SSE subscription failed with status ${response.status}`)
    }

    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
    const decoder: TextDecoder = new TextDecoder()
    let buffered: string = ''

    while (!controller.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break

        buffered += decoder.decode(value, { stream: true })
        const blocks: string[] = buffered.split('\n\n')
        buffered = blocks.pop() ?? ''

        for (const block of blocks) {
            const event: SourceTaggedDelta | null = parseSSEBlock(block)
            if (event) {
                forwardDelta(event, mainWindow)
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

export function subscribeToDaemonSSE(
    sessionId: string,
    baseUrl: string,
    mainWindow: Electron.BrowserWindow,
): void {
    unsubscribeFromDaemonSSE()

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
