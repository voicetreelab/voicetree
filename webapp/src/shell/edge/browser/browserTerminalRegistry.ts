// Drives the renderer's floating-terminal UI from the VTD `terminal-registry`
// SSE. In the browser the Electron main process — which normally subscribes
// this SSE and calls `uiAPI.launchTerminalOntoUI` (edge/main/.../openProject.ts)
// — does not exist; main+renderer collapse into the one browser process. So we
// drive the UI here, routing through the SAME `ui:call` seam the renderer's
// `uiAPIHandler` dispatches (`emit('ui:call', null, fn, args)`), keeping the
// browser runtime free of any UI-layer import.

import {callVtdRpc, vtdSubscribeTerminalRegistry} from './vtd-clients/vtdRpc'
import type {TerminalRecord, TerminalRegistryEvent} from '@vt/vt-daemon-protocol'
import {selectTerminalsToRehydrate} from '@/shell/agent/terminals/selectTerminalsToRehydrate'

type Emit = (channel: string, ...args: unknown[]) => void

const launchOntoUI = (emit: Emit, contextNodeId: string, terminalData: unknown, skipFitAnimation: boolean): void =>
    emit('ui:call', null, 'launchTerminalOntoUI', [contextNodeId, terminalData, skipFitAnimation])

/**
 * Subscribe the live terminal-registry SSE and render each spawn. The daemon
 * emits an imperative `terminal-ui-launch` per spawn; without rendering it the
 * spawn succeeds and the node broadcasts, but no terminal panel ever appears.
 */
export function subscribeBrowserTerminalRegistry(
    vtdUrl: string,
    vtdToken: string,
    sessionId: string,
    emit: Emit,
): void {
    vtdSubscribeTerminalRegistry(
        vtdUrl, vtdToken, sessionId,
        (data) => {
            let event: TerminalRegistryEvent
            try { event = (JSON.parse(data) as {event: TerminalRegistryEvent}).event } catch { return }
            emit('terminal-registry', event)
            if (event.type === 'terminal-ui-launch') {
                launchOntoUI(emit, event.nodeId, event.terminalData, event.skipFitAnimation)
            }
        },
        (err) => console.error('[browserRuntime] terminal-registry SSE error:', err),
    )
}

/**
 * Re-launch a floating panel for every live terminal. Spawn-time
 * `terminal-ui-launch` events are one-shot and never replayed, so a Cmd+R reload
 * (or a fresh tab opening a project with running agents) would otherwise show no
 * panels even though the agents are alive in tmux. The browser parity of
 * Electron's `rehydrateTerminalPanels` — pull the authoritative records and
 * drive the same seam (skipFitAnimation: a reload must not yank the viewport to
 * each of N panels or steal focus).
 */
export async function rehydrateBrowserTerminals(vtdUrl: string, vtdToken: string, emit: Emit): Promise<void> {
    const records = await callVtdRpc<readonly TerminalRecord[]>(vtdUrl, vtdToken, 'getTerminalRecords', {})
    for (const target of selectTerminalsToRehydrate(records)) {
        launchOntoUI(emit, target.contextNodeId, target.terminalData, true)
    }
}
