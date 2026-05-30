import path from 'node:path'
import { promises as fs } from 'node:fs'
import log from 'electron-log'
import { getCallbacks } from '@vt/graph-model'
import { initializeProject } from '@vt/app-config/project'
import {
    getProjectConfigForDirectory,
    saveLastDirectory,
    saveProjectConfigForDirectory,
} from '@vt/app-config/project-config'
import type { ProjectConfig } from '@vt/graph-model/settings'
import type { OpenProjectResponse } from '@vt/graph-db-client'

import { markLoadTiming, startLoadTiming } from '@/shell/edge/main/observability/diagnostics/loadTiming'
import { getStartupFolderOverride } from '@/shell/edge/main/runtime/electron/startup/startup-folder-override'
import type { TerminalRecord } from '@vt/vt-daemon-client'

import { setActiveProjectAndEnsureDaemon } from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon'
import { startDaemonGraphSync, stopDaemonGraphSync } from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-watch-sync'
import { unsubscribeFromDaemonSSE } from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-sse-subscription'
import {
    subscribeToTerminalRegistrySse,
    unsubscribeFromTerminalRegistrySse,
    type TerminalRegistryEnvelope,
} from '@/shell/edge/main/runtime/electron/daemon/sync/terminal-registry-sse-subscription'
import {
    applyTerminalRegistryEnvelope,
    primeTerminalRegistryCache,
    resetTerminalRegistryCache,
} from '@/shell/edge/main/agent/terminals/terminal-registry-bridge'
import { bindVtDaemonForProject, getVtDaemonFacade } from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import { uiAPI } from '@/shell/edge/main/runtime/ui-api-proxy'
import { getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'

export type StartupProjectHint =
    | { readonly kind: 'open-folder'; readonly projectPath: string }
    | { readonly kind: 'none' }

function pushToRenderer(
    channel: 'project:switching' | 'project:ready' | 'project:lost',
    payload: unknown,
): void {
    const mainWindow: Electron.BrowserWindow | null = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(channel, payload)
}

/**
 * Fold one `terminal-registry` SSE envelope into Main's local cache
 * mirror and fan-out the imperative UI events to the renderer.
 *
 * `applyTerminalRegistryEnvelope` updates the cache and fires the
 * mutation listeners (renderer sync, completion notifier, recovery
 * polling) registered at boot. UI-instruction events bypass the cache —
 * they tell the renderer to imperatively open / register a panel.
 */
function handleTerminalRegistryEnvelope(envelope: TerminalRegistryEnvelope): void {
    const outcome = applyTerminalRegistryEnvelope(envelope)
    if (outcome.kind !== 'ui-instruction') return
    const event = outcome.event
    if (event.type === 'terminal-ui-launch') {
        void uiAPI.launchTerminalOntoUI(event.nodeId, event.terminalData, event.skipFitAnimation)
    }
    // `terminal-ui-child-registered`: no webapp-side action. The agent-
    // completion monitor's terminal-id table lives in vtd's process and is
    // updated there by `buildPublishTerminalRegistryEvent` (vtd.ts) on the
    // same event; webapp's previous in-process `registerChildIfMonitored`
    // mutated a disjoint, empty Map (no monitor entries in webapp).
}

async function pathIsDirectory(directoryPath: string): Promise<boolean> {
    try {
        return (await fs.stat(directoryPath)).isDirectory()
    } catch {
        return false
    }
}

function resolveLocalWriteFolderPath(projectPath: string, writeFolderPath: string): string {
    return path.isAbsolute(writeFolderPath)
        ? writeFolderPath
        : path.join(projectPath, writeFolderPath)
}

async function resolveOrCreateWriteFolderPath(projectPath: string): Promise<string> {
    const existingConfig: ProjectConfig | undefined = await getProjectConfigForDirectory(projectPath)
    if (existingConfig?.writeFolderPath) {
        const writeFolderPath: string = resolveLocalWriteFolderPath(projectPath, existingConfig.writeFolderPath)
        if (await pathIsDirectory(writeFolderPath)) {
            return writeFolderPath
        }
    }

    const onboardingRoot: string | undefined = getCallbacks().getOnboardingDirectory?.()
    const onboardingSourceDir: string | undefined = onboardingRoot
        ? path.join(onboardingRoot, 'voicetree')
        : undefined
    const initializedPath: string | null = await initializeProject(projectPath, onboardingSourceDir)
    const writeFolderPath: string = initializedPath ?? projectPath
    await saveProjectConfigForDirectory(projectPath, { writeFolderPath })
    return writeFolderPath
}

export async function getStartupProjectHint(): Promise<StartupProjectHint> {
    const startupFolder: string | null = getStartupFolderOverride()
    if (startupFolder !== null) {
        return { kind: 'open-folder', projectPath: startupFolder }
    }

    return { kind: 'none' }
}

export async function openProject(projectRoot: string): Promise<OpenProjectResponse> {
    if (!(await pathIsDirectory(projectRoot))) {
        throw new Error(`Path is not a directory: ${projectRoot}`)
    }

    startLoadTiming(projectRoot)
    pushToRenderer('project:switching', { path: projectRoot })

    try {
        // D6: stop SSE/watch-sync loops bound to the prior owner's base URL
        // before any new owner-mediated work begins, so reconnect pollers
        // can never see a stale daemon and fork-spawn replacements.
        await getCallbacks().onProjectSwitching?.()
        getCallbacks().onGraphCleared?.()
        unsubscribeFromDaemonSSE()
        // Tear down the prior terminal-registry SSE before rebinding so
        // the project-switch fence has no chance to be evaluated against a
        // half-flipped activeProject — `bindVtDaemonForProject` below will
        // resubscribe under the new project.
        unsubscribeFromTerminalRegistrySse()
        resetTerminalRegistryCache()
        await stopDaemonGraphSync()

        // Rebind to the per-project VTD child BEFORE any further
        // renderer-visible side effect. Renderer subscriptions can fire
        // `api.main.getDaemonUrl()` reactively on `project:switching`
        // (pushed above) or on startup events — if the bind sits behind
        // the full project-open sequence, those calls throw
        // `daemon_unreachable` until the ensure path resolves. The
        // ensure call is self-contained (writes its own .voicetree/
        // files, spawns the child or adopts an existing healthy owner,
        // and sets module state) and has no dependency on the graph
        // daemon spawn or writeFolderPath resolution that follows.
        //
        // Cold-start tail latency is worse than the pre-Phase-2 in-process
        // bind (spawn + readiness wait vs. an in-process listen), but the
        // happy path (existing healthy owner discoverable on disk) is
        // dominated by a single /health round-trip — comparable to the
        // pre-Phase-2 numbers.
        await bindVtDaemonForProject(projectRoot)

        // Cold-start: prime the terminal-registry cache from the daemon's
        // authoritative snapshot before opening the SSE feed. Without
        // this, the first listeners would see an empty cache until the
        // hub catches the renderer up via deltas — which only happens
        // when something changes. Cold-start primes the mirror and fires
        // every listener once so the renderer / completion notifier /
        // recovery pollers start from a coherent state.
        const initialRecords: readonly TerminalRecord[] =
            await getVtDaemonFacade().terminals.getTerminalRecords({})
        primeTerminalRegistryCache(initialRecords)

        // Re-open the terminal-registry SSE against the freshly-bound
        // VTD. The subscriber owns its own reconnect loop; project-switch
        // tears it down (above) and we open a fresh one here. The
        // handler folds cache-mutation events into the local mirror via
        // `applyTerminalRegistryEnvelope`, and forwards the imperative
        // UI events (`terminal-ui-launch`, `terminal-ui-child-registered`)
        // to the renderer.
        subscribeToTerminalRegistrySse('electron-main', handleTerminalRegistryEnvelope)

        // Persist writeFolderPath BEFORE the daemon claims the project: vt-graphd's
        // startup project-open reads saved config, and the daemon's
        // `openProjectWorkflow` short-circuits on a re-open with the same path
        // — so the writeFolderPath we pass below must already be on disk for the
        // first ensure to pick it up.
        const writeFolderPath: string = await resolveOrCreateWriteFolderPath(projectRoot)
        await getCallbacks().ensureProjectSetup?.(projectRoot).catch((error: unknown) => {
            log.warn('[openProject] Failed to set up .voicetree/ defaults:', error)
        })

        markLoadTiming('main:daemon-open-project-start')
        const owner = await setActiveProjectAndEnsureDaemon(projectRoot)
        // The owner-aware spawn already opened the project at startup using
        // the saved writeFolderPath. This call is the idempotent confirmation
        // that returns the daemon's authoritative `OpenProjectResponse`.
        const response = await owner.client.openProject(projectRoot, { writeFolderPath })
        markLoadTiming('main:daemon-open-project-end')

        await startDaemonGraphSync(projectRoot)
        markLoadTiming('main:daemon-graph-sync-started')
        await saveLastDirectory(projectRoot)

        const watchingStartedInfo = {
            directory: projectRoot,
            projectRoot,
            writeFolderPath: response.writeFolderPath,
            timestamp: new Date().toISOString(),
        }
        await getCallbacks().onProjectOpened?.(watchingStartedInfo)
        getCallbacks().onWatchingStarted?.(watchingStartedInfo)

        pushToRenderer('project:ready', { path: projectRoot, sessionId: response.sessionId })
        void getCallbacks().stripStaleMcpEntries?.(projectRoot).catch((err: unknown) => {
            console.error('[openProject] Failed to strip stale VoiceTree client-config entries:', err)
        })
        void getCallbacks().writeProjectAgentDiscoveryFile?.(projectRoot).catch((err: unknown) => {
            console.error('[openProject] Failed to write project agent discovery file:', err)
        })
        return response
    } catch (err) {
        pushToRenderer('project:lost', {
            path: projectRoot,
            error: err instanceof Error ? err.message : String(err),
        })
        throw err
    }
}
