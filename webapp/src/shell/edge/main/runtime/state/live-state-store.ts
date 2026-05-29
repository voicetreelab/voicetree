/**
 * BF-380 · Phase 3 — Main-side live-command dispatch.
 *
 * The legacy Main-owned mirror is gone. State is owned by the
 * daemon (`packages/systems/vt-daemon/src/state/sessionStateStore.ts`).
 * This module exposes a single deep function: `applyLiveCommand` decides
 * whether a command needs renderer authority (Select/Deselect/SetZoom/
 * SetPan/RequestFit) and, regardless, dispatches the same command to the
 * daemon over JSON-RPC so every client (Electron Main + CLI) sees the same
 * post-state.
 */
import type { Command, Delta } from '@vt/graph-state'

import { dispatchLiveCommandToDaemon } from './daemon-live-state-rpc'
import {
    applyRendererLiveCommand,
    isRendererOwnedLiveCommand,
} from './renderer-live-state-proxy'

export async function applyLiveCommand(cmd: Command): Promise<Delta> {
    if (isRendererOwnedLiveCommand(cmd)) {
        await applyRendererLiveCommand(cmd)
    }
    return await dispatchLiveCommandToDaemon(cmd)
}
