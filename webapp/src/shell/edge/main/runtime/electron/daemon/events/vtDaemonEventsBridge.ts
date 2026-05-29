/**
 * Main-process IPC bridge for the VTD /events stream (Phase 0 / BF-367).
 *
 * Owns one `createVtDaemonEventsClient` and pushes every event / gap / state
 * change to the active renderer's `webContents.send`. Also exposes a
 * `vt:events:resnapshot` invoke channel so the renderer can request a fresh
 * subscribe with `resumeSeq: 0`.
 *
 * Single-window assumption matches the rest of Main (uiAPI proxy, terminal
 * relay bridge). When the BrowserWindow is destroyed mid-stream the
 * webContents-isDestroyed check no-ops the send.
 */
import {ipcMain, type BrowserWindow} from 'electron'
import type {ConnectionState, EventFrame, GapFrame, TopicName} from '@vt/vt-daemon/transport/eventTypes'
import {createVtDaemonEventsClient, type VtDaemonEventsClient} from './vtDaemonEventsClient'

const TOPICS: readonly TopicName[] = ['agent-lifecycle']
const EVENTS_CHANNEL: string = 'vt:events'
const CONNECTION_CHANNEL: string = 'vt:events:connection'
const RESNAPSHOT_INVOKE: string = 'vt:events:resnapshot'

export interface VtDaemonEventsBridgeDeps {
    readonly getMainWindow: () => BrowserWindow | null
    readonly getDaemonUrl: () => Promise<string>
    readonly getAuthToken: () => Promise<string>
    readonly random?: () => number
    readonly setTimeoutImpl?: typeof setTimeout
    readonly clearTimeoutImpl?: typeof clearTimeout
}

export function installVtDaemonEventsBridge(deps: VtDaemonEventsBridgeDeps): () => void {
    const sendToRenderer = (channel: string, payload: unknown): void => {
        const window: BrowserWindow | null = deps.getMainWindow()
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
        window.webContents.send(channel, payload)
    }

    const client: VtDaemonEventsClient = createVtDaemonEventsClient({
        getDaemonUrl: deps.getDaemonUrl,
        getAuthToken: deps.getAuthToken,
        topics: TOPICS,
        onEvent: (frame: EventFrame): void => sendToRenderer(EVENTS_CHANNEL, frame),
        onGap: (frame: GapFrame): void => sendToRenderer(EVENTS_CHANNEL, frame),
        onConnectionState: (state: ConnectionState): void => sendToRenderer(CONNECTION_CHANNEL, state),
        random: deps.random,
        setTimeoutImpl: deps.setTimeoutImpl,
        clearTimeoutImpl: deps.clearTimeoutImpl,
    })

    ipcMain.handle(RESNAPSHOT_INVOKE, (_event, topic: TopicName): Promise<void> => client.resnapshot(topic))

    return (): void => {
        ipcMain.removeHandler(RESNAPSHOT_INVOKE)
        client.close()
    }
}
