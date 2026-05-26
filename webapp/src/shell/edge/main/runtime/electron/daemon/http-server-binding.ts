// Electron-side lifecycle for the unified HTTP daemon server (design doc
// §2.5). One http.createServer per opened vault, replacing the pre-Step-9
// trio of separate transports. 9f folds the tmux relay onto the
// /terminals/:id/attach route; until then that route returns HTTP 503 on
// upgrade.
//
// Per-vault binding: the auth token + port file are written under each
// opened vault's `.voicetree/` so spawned-agent shells (which discover the
// daemon via cwd up-walk) hit the correct one. Concurrency: openVault may
// be invoked in parallel; serialize through a pending promise chain so a
// rebind never races a teardown.

import {
    buildDefaultToolCatalog,
    handleHookEventRequest,
    startHttpDaemonServer,
    startVaultStateWatcher,
    type HttpDaemonServerHandle,
    type HookHandler,
    type ToolCatalog,
    type VaultStateWatcherHandle,
} from '@vt/vt-daemon'
import {terminalRuntimeSurface} from '@/shell/edge/main/agent/terminals/terminalRuntimeSurface'
import {generateAuthToken, writeAuthTokenFile, writeRpcPortFile} from '@vt/vt-rpc'

interface BoundState {
    readonly vaultPath: string
    readonly handle: HttpDaemonServerHandle
    readonly watcher: VaultStateWatcherHandle
    readonly token: string
}

let currentBound: BoundState | null = null
let pending: Promise<void> = Promise.resolve()

function chain<T>(work: () => Promise<T>): Promise<T> {
    const next: Promise<T> = pending.then(work, work) as Promise<T>
    pending = next.then((): void => {}, (): void => {})
    return next
}

const hookHandler: HookHandler = (input): unknown =>
    handleHookEventRequest(
        {source: input.source, terminalId: input.terminalId, hookEventName: input.eventName},
        {updateAgentEvent: terminalRuntimeSurface.updateTerminalAgentEvent},
    )

export function bindHttpDaemonForVault(vaultPath: string): Promise<HttpDaemonServerHandle> {
    return chain(async (): Promise<HttpDaemonServerHandle> => {
        if (currentBound?.vaultPath === vaultPath) {
            return currentBound.handle
        }
        if (currentBound) {
            const prev: BoundState = currentBound
            currentBound = null
            await prev.watcher.stop().catch((cause: unknown): void => {
                console.error('[http-daemon] watcher stop during rebind:', cause)
            })
            await prev.handle.stop().catch((cause: unknown): void => {
                console.error('[http-daemon] server stop during rebind:', cause)
            })
        }

        const token: string = generateAuthToken()
        await writeAuthTokenFile(vaultPath, token)

        const catalog: ToolCatalog = buildDefaultToolCatalog()
        const handle: HttpDaemonServerHandle = await startHttpDaemonServer({
            catalog,
            hookHandler,
            token,
            bindHost: process.env.VOICETREE_DAEMON_BIND ?? '0.0.0.0',
        })

        await writeRpcPortFile(vaultPath, handle.port)
        const watcher: VaultStateWatcherHandle = startVaultStateWatcher({
            vaultPath,
            hub: handle.hub,
        })

        currentBound = {vaultPath, handle, watcher, token}
        return handle
    })
}

export function unbindHttpDaemon(): Promise<void> {
    return chain(async (): Promise<void> => {
        const bound: BoundState | null = currentBound
        if (!bound) return
        currentBound = null
        await bound.watcher.stop().catch((cause: unknown): void => {
            console.error('[http-daemon] watcher stop:', cause)
        })
        await bound.handle.stop().catch((cause: unknown): void => {
            console.error('[http-daemon] server stop:', cause)
        })
    })
}

export function getActiveDaemonUrl(): string | null {
    return currentBound?.handle.url ?? null
}

export function getActiveAuthToken(): string | null {
    return currentBound?.token ?? null
}
