import path from 'node:path'
import { promises as fs } from 'node:fs'
import * as O from 'fp-ts/lib/Option.js'
import log from 'electron-log'
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
import { setActiveVaultAndEnsureDaemon } from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon'
import { startDaemonGraphSync, stopDaemonGraphSync } from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-watch-sync'
import { unsubscribeFromDaemonSSE } from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-sse-subscription'
import { bindHttpDaemonForVault } from '@/shell/edge/main/runtime/electron/daemon/http-server-binding'
import { getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'

export type StartupVaultHint =
    | { readonly kind: 'open-folder'; readonly path: string }
    | { readonly kind: 'last-directory'; readonly path: string }
    | { readonly kind: 'none' }

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

function resolveLocalWriteFolder(projectPath: string, writeFolder: string): string {
    return path.isAbsolute(writeFolder)
        ? writeFolder
        : path.join(projectPath, writeFolder)
}

async function resolveOrCreateWriteFolder(projectPath: string): Promise<string> {
    const existingConfig: VaultConfig | undefined = await getVaultConfigForDirectory(projectPath)
    if (existingConfig?.writeFolder) {
        const writeFolder: string = resolveLocalWriteFolder(projectPath, existingConfig.writeFolder)
        if (await pathIsDirectory(writeFolder)) {
            return writeFolder
        }
    }

    const onboardingRoot: string | undefined = getCallbacks().getOnboardingDirectory?.()
    const onboardingSourceDir: string | undefined = onboardingRoot
        ? path.join(onboardingRoot, 'voicetree')
        : undefined
    const initializedPath: string | null = await initializeProject(projectPath, onboardingSourceDir)
    const writeFolder: string = initializedPath ?? projectPath
    await saveVaultConfigForDirectory(projectPath, { writeFolder })
    return writeFolder
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

export async function openVault(projectRoot: string): Promise<OpenVaultResponse> {
    if (!(await pathIsDirectory(projectRoot))) {
        throw new Error(`Path is not a directory: ${projectRoot}`)
    }

    startLoadTiming(projectRoot)
    pushToRenderer('vault:switching', { path: projectRoot })

    try {
        // D6: stop SSE/watch-sync loops bound to the prior owner's base URL
        // before any new owner-mediated work begins, so reconnect pollers
        // can never see a stale daemon and fork-spawn replacements.
        await getCallbacks().onVaultSwitching?.()
        getCallbacks().onGraphCleared?.()
        unsubscribeFromDaemonSSE()
        await stopDaemonGraphSync()

        // Rebind the in-process HTTP daemon to the new vault BEFORE any
        // further renderer-visible side effect. Renderer subscriptions can
        // fire `api.main.getDaemonUrl()` reactively on `vault:switching`
        // (pushed above) or on startup events — if the bind sits behind the
        // full vault-open sequence, those calls throw `daemon_unreachable`
        // for ~1s. The bind is self-contained (writes its own .voicetree/
        // files via mkdir -p, starts an HTTP listener, sets module state)
        // and has no dependency on the graph daemon spawn or writeFolder
        // resolution that follows.
        await bindHttpDaemonForVault(projectRoot)

        // Persist writeFolder BEFORE the daemon claims the vault: vt-graphd's
        // startup vault-open reads saved config, and the daemon's
        // `openVaultWorkflow` short-circuits on a re-open with the same path
        // — so the writeFolder we pass below must already be on disk for the
        // first ensure to pick it up.
        const writeFolder: string = await resolveOrCreateWriteFolder(projectRoot)
        await getCallbacks().ensureProjectSetup?.(projectRoot).catch((error: unknown) => {
            log.warn('[openVault] Failed to set up .voicetree/ defaults:', error)
        })

        markLoadTiming('main:daemon-open-vault-start')
        const owner = await setActiveVaultAndEnsureDaemon(projectRoot)
        // The owner-aware spawn already opened the vault at startup using
        // the saved writeFolder. This call is the idempotent confirmation
        // that returns the daemon's authoritative `OpenVaultResponse`.
        const response = await owner.client.openVault(projectRoot, { writeFolder })
        markLoadTiming('main:daemon-open-vault-end')

        await startDaemonGraphSync(projectRoot)
        markLoadTiming('main:daemon-graph-sync-started')
        await saveLastDirectory(projectRoot)

        const watchingStartedInfo = {
            directory: projectRoot,
            writeFolder: response.writeFolder,
            timestamp: new Date().toISOString(),
        }
        await getCallbacks().onVaultOpened?.(watchingStartedInfo)
        getCallbacks().onWatchingStarted?.(watchingStartedInfo)

        pushToRenderer('vault:ready', { path: projectRoot })
        void getCallbacks().stripStaleMcpEntries?.(projectRoot).catch((err: unknown) => {
            console.error('[openVault] Failed to strip stale MCP entries:', err)
        })
        void getCallbacks().writeVaultAgentDiscoveryFile?.(projectRoot).catch((err: unknown) => {
            console.error('[openVault] Failed to write vault agent discovery file:', err)
        })
        return response
    } catch (err) {
        pushToRenderer('vault:lost', {
            path: projectRoot,
            error: err instanceof Error ? err.message : String(err),
        })
        throw err
    }
}
