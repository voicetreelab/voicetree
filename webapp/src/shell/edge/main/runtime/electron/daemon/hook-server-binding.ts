// Electron-side lifecycle for the dedicated hook HTTP server (Step 7e).
//
// Unlike the UDS socket (per-vault path) the hook HTTP server binds a single
// ephemeral port for the lifetime of the app. The port is then *published*
// to each vault that opens, by writing `<vault>/.voicetree/hook.port` — the
// spawn pipeline reads that file when assembling each new agent's env block
// (design doc §3.4).

import {
    startHookHttpServer,
    writeHookPortFile,
    type HookHttpServerHandle,
} from '@vt/voicetree-mcp'
import {agentRuntime} from '@vt/agent-runtime'

let handle: HookHttpServerHandle | null = null

export async function startElectronHookHttpServer(): Promise<void> {
    if (handle) return
    handle = await startHookHttpServer({
        updateAgentEvent: agentRuntime.updateTerminalAgentEvent,
    })
}

export async function stopElectronHookHttpServer(): Promise<void> {
    if (!handle) return
    const local: HookHttpServerHandle = handle
    handle = null
    await local.stop().catch((cause: unknown): void => {
        console.error('[electron-hook] stop error:', cause)
    })
}

export async function publishHookPortForVault(vaultPath: string): Promise<void> {
    if (!handle) return
    await writeHookPortFile(vaultPath, handle.port)
}
