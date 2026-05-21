// Per-vault UDS server lifecycle for Electron.
//
// Electron main holds one in-process MCP/tool catalog shared across vaults
// (the legacy HTTP MCP server is bound once at app startup). For UDS, the
// socket path is per-vault (design doc §3.1), so we (re)bind whenever a
// vault opens and unbind on folder switch / vault close.
//
// Concurrency: openVault may be invoked in parallel (parallel-load-folder
// idempotency test). We serialize bind/unbind through a single pending
// promise and skip a rebind when the requested vault is already bound.

import {
    buildDefaultToolCatalog,
    resolveVaultSocketPath,
    startUdsServer,
    type UdsServerHandle,
} from '@vt/voicetree-mcp'

interface BoundState {
    readonly socketPath: string
    readonly handle: UdsServerHandle
}

let currentBound: BoundState | null = null
let pending: Promise<void> = Promise.resolve()

function chain(work: () => Promise<void>): Promise<void> {
    const next: Promise<void> = pending.then(work, work)
    pending = next.catch((): void => {})
    return next
}

export function bindUdsServerForVault(vaultPath: string): Promise<void> {
    return chain(async (): Promise<void> => {
        const socketPath: string = resolveVaultSocketPath(vaultPath)
        if (currentBound?.socketPath === socketPath) {
            return // already serving this vault
        }
        if (currentBound) {
            await currentBound.handle.stop().catch((cause: unknown): void => {
                console.error('[electron-uds] stop error during rebind:', cause)
            })
            currentBound = null
        }
        const handle: UdsServerHandle = await startUdsServer({
            socketPath,
            catalog: buildDefaultToolCatalog(),
        })
        currentBound = {socketPath, handle}
    })
}

export function unbindUdsServer(): Promise<void> {
    return chain(async (): Promise<void> => {
        const bound: BoundState | null = currentBound
        if (!bound) return
        currentBound = null
        await bound.handle.stop().catch((cause: unknown): void => {
            console.error('[electron-uds] stop error:', cause)
        })
    })
}
