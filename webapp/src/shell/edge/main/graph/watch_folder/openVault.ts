import path from 'node:path'
import { promises as fs } from 'node:fs'
import * as O from 'fp-ts/lib/Option.js'
import { getCallbacks } from '@vt/graph-model'
import { initializeProject } from '@vt/app-config/project'
import {
    getLastDirectory,
    getVaultConfigForDirectory,
    saveLastDirectory,
    saveVaultConfigForDirectory,
} from '@vt/app-config/vault-config'
import type { VaultConfig } from '@vt/graph-model/settings'
import type { OpenVaultResponse } from '@vt/graph-db-client'

import { markLoadTiming, startLoadTiming } from '@/shell/edge/main/observability/diagnostics/loadTiming'
import { getStartupFolderOverride } from '@/shell/edge/main/runtime/electron/startup/startup-folder-override'
import { ensureDaemonProcess, callDaemon } from '@/shell/edge/main/runtime/electron/daemon/graph-daemon'
import { startDaemonGraphSync, stopDaemonGraphSync } from '@/shell/edge/main/runtime/electron/daemon/daemon-watch-sync'
import { unsubscribeFromDaemonSSE } from '@/shell/edge/main/runtime/electron/daemon/daemon-sse-subscription'
import { bindUdsServerForVault, unbindUdsServer } from '@/shell/edge/main/runtime/electron/daemon/uds-server-binding'
import { publishHookPortForVault } from '@/shell/edge/main/runtime/electron/daemon/hook-server-binding'
import { getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'
import { syncWatchedProjectRoot } from '@/shell/edge/main/runtime/state/live-state-store'

export type StartupVaultHint =
    | { readonly kind: 'open-folder'; readonly path: string }
    | { readonly kind: 'last-directory'; readonly path: string }
    | { readonly kind: 'none' }

let onFolderSwitchCleanup: (() => void) | null = null

export function setOnFolderSwitchCleanup(cleanup: (() => void) | null): void {
    onFolderSwitchCleanup = cleanup
}

function pushToRenderer(
    channel: 'vault:switching' | 'vault:ready' | 'vault:lost',
    payload: unknown,
): void {
    const mainWindow: Electron.BrowserWindow | null = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(channel, payload)
}

async function pathIsDirectory(directoryPath: string): Promise<boolean> {
    try {
        return (await fs.stat(directoryPath)).isDirectory()
    } catch {
        return false
    }
}

function resolveLocalWritePath(projectPath: string, writePath: string): string {
    return path.isAbsolute(writePath)
        ? writePath
        : path.join(projectPath, writePath)
}

async function resolveOrCreateWritePath(projectPath: string): Promise<string> {
    const existingConfig: VaultConfig | undefined = await getVaultConfigForDirectory(projectPath)
    if (existingConfig?.writePath) {
        const writePath: string = resolveLocalWritePath(projectPath, existingConfig.writePath)
        if (await pathIsDirectory(writePath)) {
            return writePath
        }
    }

    const onboardingRoot: string | undefined = getCallbacks().getOnboardingDirectory?.()
    const onboardingSourceDir: string | undefined = onboardingRoot
        ? path.join(onboardingRoot, 'voicetree')
        : undefined
    const initializedPath: string | null = await initializeProject(projectPath, onboardingSourceDir)
    const writePath: string = initializedPath ?? projectPath
    await saveVaultConfigForDirectory(projectPath, { writePath })
    return writePath
}

export async function getStartupVaultHint(): Promise<StartupVaultHint> {
    const startupFolder: string | null = getStartupFolderOverride()
    if (startupFolder !== null) {
        return { kind: 'open-folder', path: startupFolder }
    }

    const lastDirectory: O.Option<string> = await getLastDirectory()
    return O.isSome(lastDirectory)
        ? { kind: 'last-directory', path: lastDirectory.value }
        : { kind: 'none' }
}

export async function openVault(vaultPath: string): Promise<OpenVaultResponse> {
    if (!(await pathIsDirectory(vaultPath))) {
        throw new Error(`Path is not a directory: ${vaultPath}`)
    }

    startLoadTiming(vaultPath)
    await ensureDaemonProcess()
    pushToRenderer('vault:switching', { path: vaultPath })

    try {
        onFolderSwitchCleanup?.()
        getCallbacks().onGraphCleared?.()
        unsubscribeFromDaemonSSE()
        await stopDaemonGraphSync()
        await unbindUdsServer()

        const writePath: string = await resolveOrCreateWritePath(vaultPath)
        await getCallbacks().ensureProjectSetup?.(vaultPath).catch((error: unknown) => {
            console.warn('[openVault] Failed to set up .voicetree/ defaults:', error)
        })

        markLoadTiming('main:daemon-open-vault-start')
        const response = await callDaemon((client) => client.openVault(vaultPath, { writePath }))
        markLoadTiming('main:daemon-open-vault-end')

        await startDaemonGraphSync(vaultPath)
        markLoadTiming('main:daemon-graph-sync-started')
        await saveLastDirectory(vaultPath)
        syncWatchedProjectRoot(vaultPath)

        getCallbacks().onWatchingStarted?.({
            directory: vaultPath,
            writePath: response.writePath,
            timestamp: new Date().toISOString(),
        })

        await bindUdsServerForVault(vaultPath)
        await publishHookPortForVault(vaultPath).catch((err: unknown) => {
            console.error('[openVault] Failed to publish hook.port:', err)
        })

        pushToRenderer('vault:ready', { path: vaultPath })
        void getCallbacks().stripStaleMcpEntries?.(vaultPath).catch((err: unknown) => {
            console.error('[openVault] Failed to strip stale MCP entries:', err)
        })
        void getCallbacks().writeVaultAgentDiscoveryFile?.(vaultPath).catch((err: unknown) => {
            console.error('[openVault] Failed to write vault agent discovery file:', err)
        })
        return response
    } catch (err) {
        pushToRenderer('vault:lost', {
            path: vaultPath,
            error: err instanceof Error ? err.message : String(err),
        })
        throw err
    }
}
