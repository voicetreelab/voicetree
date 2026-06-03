// Browser-mode HostAPI adapter.
// Implements the HostAPI contract from webapp/src/shell/electron.d.ts by
// talking ONLY to VTD over JSON-RPC + WebSocket. Under the gateway model
// vt-graphd is loopback-internal behind VTD: every graph read/mutation/view op
// is a `graph.*` RPC (vtdGraphClient.ts) and every live graph update rides the
// existing VTD /events WS on topic `'graph'`. The adapter must be installed on
// window.hostAPI BEFORE React bootstraps so App.tsx's electronReady check
// fires on the first poll.

import * as O from 'fp-ts/lib/Option.js'
import type {NodeDefinition} from 'cytoscape'
import type {HostAPI, Promisify} from '@/shell/hostApi'
import {collectNodePositions} from '@/shell/edge/UI-edge/graph/collectNodePositions'
import type {mainAPI} from '@/shell/edge/main/runtime/api'
import type {GraphDelta} from '@vt/graph-model/graph'
import type {ConnectionState, EventFrame, GapFrame, TopicName} from '@vt/vt-daemon/transport/eventTypes'
import type {VTSettings} from '@vt/graph-model/settings'
import type {BrowserDaemonConfig} from './browserConfig'
import {callVtdRpc, vtdGetSettings, vtdSubscribeEvents, vtdSubscribeTerminalRegistry} from './vtdRpc'
import {
    vtdActivateView,
    vtdApplyDelta,
    vtdCloneView,
    vtdCreateContextNode,
    vtdDeleteView,
    vtdFindFileByName,
    vtdGetGraph,
    vtdGetNode,
    vtdGetPreviewContainedNodeIds,
    vtdGetProject,
    vtdGetProjectedGraph,
    vtdListViews,
    vtdOpenProject,
    vtdRedo,
    vtdSetWriteFolderPath,
    vtdUndo,
    vtdWriteMarkdownFile,
    vtdWritePositions,
} from './vtdGraphClient'
import {createBrowserTerminalRuntime} from './browserTerminal'
import {resumeOnReconnect, routeGraphFrame} from './graphEventStream'
import {BROWSER_CAPABILITIES} from '@/shell/runtimeCapabilities'
import {
    vtdCreateWorktree,
    vtdGenerateWorktreeName,
    vtdListWorktrees,
    vtdRemoveWorktree,
    vtdRemoveWorktreeCommand,
} from './vtdWorktreeClient'

type Listener = (...args: unknown[]) => void

function unsupported(name: string): never {
    throw new Error(`[browserRuntime] ${name} is not supported in browser mode`)
}

export function buildBrowserRuntime(cfg: BrowserDaemonConfig, sessionId: string): HostAPI {
    const {vtdUrl, vtdToken, projectPath} = cfg
    const currentSessionId = sessionId
    const channelListeners = new Map<string, Set<Listener>>()
    const terminalRuntime = createBrowserTerminalRuntime()

    function emit(channel: string, ...args: unknown[]): void {
        for (const l of channelListeners.get(channel) ?? []) l(...args)
    }

    function addListener(channel: string, listener: Listener): () => void {
        let set = channelListeners.get(channel)
        if (!set) { set = new Set(); channelListeners.set(channel, set) }
        set.add(listener)
        return () => set!.delete(listener)
    }

    function patchTerminalRecord(kind: string): (id: string, value: unknown) => Promise<unknown> {
        return (id, value) =>
            callVtdRpc(vtdUrl, vtdToken, 'patchTerminalRecord', {
                terminalId: id,
                patch: {kind, value},
            })
    }

    // Re-fetch the full projected graph snapshot and emit it. Used by the
    // renderer's explicit resnapshot() and on a `graph` gap frame. ProjectedGraph
    // is a full snapshot (not a delta), so re-emitting is idempotent.
    async function resnapshotGraph(): Promise<void> {
        emit('graph:projectedGraphUpdate', await vtdGetProjectedGraph(vtdUrl, vtdToken))
    }

    // ── VTD /events WS — the ONE long-lived stream ───────────────────────────
    // Graph snapshots ride topic `'graph'` (folded in by VTD from graphd); all
    // other frames pass through to `vt:events`. On a genuine reconnect the
    // browser may have missed `graph` frames while offline, so re-snapshot — the
    // guard that a dropped frame can never leave the UI permanently stale. The
    // routing/resume decisions are pure (graphEventStream.ts); this is the shell.
    let wasDisconnected = false
    vtdSubscribeEvents(
        vtdUrl, vtdToken,
        (frame) => {
            const route = routeGraphFrame(frame)
            if (route.kind === 'projectedGraph') emit('graph:projectedGraphUpdate', route.data)
            else if (route.kind === 'resnapshot') void resnapshotGraph()
            else emit('vt:events', frame)
        },
        (state) => {
            const next = resumeOnReconnect(wasDisconnected, state)
            wasDisconnected = next.wasDisconnected
            if (next.resnapshot) void resnapshotGraph()
            emit('vt:events:connection', state)
        },
    )

    // ── VTD terminal-registry SSE ────────────────────────────────────────────
    vtdSubscribeTerminalRegistry(
        vtdUrl, vtdToken, currentSessionId,
        (data) => {
            try { emit('terminal-registry', JSON.parse(data)) } catch { /* ignore */ }
        },
        (err) => console.error('[browserRuntime] terminal-registry SSE error:', err),
    )

    const main = {
        // Graph
        applyGraphDeltaToDBThroughMemUIAndEditorExposed: (delta: GraphDelta) =>
            vtdApplyDelta(vtdUrl, vtdToken, delta),
        applyGraphDeltaToDBThroughMemAndUIExposed: (delta: GraphDelta) =>
            vtdApplyDelta(vtdUrl, vtdToken, delta),
        writeMarkdownFile: (absolutePath: string, body: string, editorId: string) =>
            vtdWriteMarkdownFile(vtdUrl, vtdToken, absolutePath, body, editorId),
        getGraph: () => vtdGetGraph(vtdUrl, vtdToken),
        getProjectedGraph: () => vtdGetProjectedGraph(vtdUrl, vtdToken),
        getNode: (nodeId: string) => vtdGetNode(vtdUrl, vtdToken, nodeId),
        reconcileGraphWithDisk: (): Promise<void> =>
            callVtdRpc(vtdUrl, vtdToken, 'reconcileGraphWithDisk', {}),
        collapseFolderThroughDaemon: (p: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'collapseFolderThroughDaemon', p as Record<string, unknown>),
        expandFolderThroughDaemon: (p: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'expandFolderThroughDaemon', p as Record<string, unknown>),
        setFolderStateThroughDaemon: (p: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'setFolderStateThroughDaemon', p as Record<string, unknown>),
        // cy.nodes().jsons() is a NodeDefinition[]; the gateway's writePositions
        // wants {positions: {nodeId: {x, y}}}. Transform before sending.
        saveNodePositions: (payload: unknown) =>
            vtdWritePositions(vtdUrl, vtdToken, collectNodePositions(payload as NodeDefinition[])),
        // The browser has no semantic-search callback (that runs in Electron
        // main), so it requests a context node with no semantic neighbours. The
        // contract returns {nodeId}; callers want the bare id.
        createContextNode: (parentNodeId: string) =>
            vtdCreateContextNode(vtdUrl, vtdToken, parentNodeId, []).then(r => r.nodeId),
        getPreviewContainedNodeIds: (nodeId: string): Promise<readonly string[]> =>
            vtdGetPreviewContainedNodeIds(vtdUrl, vtdToken, nodeId),
        performUndo: () => vtdUndo(vtdUrl, vtdToken),
        performRedo: () => vtdRedo(vtdUrl, vtdToken),
        findFileByName: (filename: string) => vtdFindFileByName(vtdUrl, vtdToken, filename),

        // Settings — fetch the resolved VTSettings from VTD (Electron parity).
        // Drives `agents` for the editor horizontal menu / agent-spawn control.
        loadSettings: (): Promise<VTSettings> => vtdGetSettings(vtdUrl, vtdToken),
        // Honest: persisting settings needs a security-gated VTD write RPC that
        // does not exist yet. Surfaced as unsupported via runtime capabilities.
        saveSettings: (): Promise<boolean> => Promise.resolve(false),

        // Project — `graph.openProject` is idempotent (VTD owns the single
        // graphd session); it returns the boot triple in one round-trip.
        openProject: async (path: string) => {
            const {projectState, initialProjectedGraph} = await vtdOpenProject(vtdUrl, vtdToken)
            emit('project:ready', {path: path || projectPath, sessionId: currentSessionId})
            return {projectState, sessionId: currentSessionId, initialProjectedGraph}
        },
        getStartupProjectHint: () => Promise.resolve({kind: 'open-folder', projectPath}),
        stopFileWatching: () => Promise.resolve(),
        shutdownGraphDaemon: () => Promise.resolve(),
        // graphd watches the project daemon-side, so the browser IS "watching"
        // via VTD. Surface the project path as the watched directory: the
        // worktree menu derives its repoRoot from `getWatchStatus().directory`.
        getWatchStatus: () => Promise.resolve({isWatching: true, directory: projectPath}),
        getProjectPaths: async () => {
            const ps = await vtdGetProject(vtdUrl, vtdToken)
            return {readPaths: ps.readPaths ?? [], writeFolderPath: ps.writeFolderPath ?? ''}
        },
        getReadPaths: async () => {
            const ps = await vtdGetProject(vtdUrl, vtdToken)
            return ps.readPaths ?? []
        },
        // Contract is O.Option<string> (callers do O.getOrElse/O.isNone). Returning
        // a bare string made O.getOrElse yield undefined, so new nodes were created
        // with a relative id (no write-folder prefix) → later writes to them hit
        // graphd's PATH_NOT_ABSOLUTE. Wrap as Some/None to match Electron.
        getWriteFolderPath: async (): Promise<O.Option<string>> => {
            const ps = await vtdGetProject(vtdUrl, vtdToken)
            return ps.writeFolderPath ? O.some(ps.writeFolderPath) : O.none
        },
        setWriteFolderPath: (path: string) => vtdSetWriteFolderPath(vtdUrl, vtdToken, path),
        addReadPath: (p: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'addReadPath', p as Record<string, unknown>),
        removeReadPath: (p: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'removeReadPath', p as Record<string, unknown>),
        getAvailableFoldersForSelector: () => Promise.resolve([]),
        createDatedVoiceTreeFolder: () => Promise.resolve(''),
        createSubfolder: () => Promise.resolve(''),
        getDirectoryTree: () => Promise.resolve(null),
        getBackendPort: () => Promise.resolve(0),
        getVoicetreeHomePath: () => Promise.resolve(''),
        getDaemonUrl: () => Promise.resolve(vtdUrl),

        // Terminals / agents (VTD JSON-RPC)
        spawnTerminalWithContextNode: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'spawnTerminalWithContextNode', req as Record<string, unknown>),
        spawnPlainTerminal: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'spawnPlainTerminal', req as Record<string, unknown>),
        spawnPlainTerminalWithNode: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'spawnPlainTerminalWithNode', req as Record<string, unknown>),
        sendTextToTerminal: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'sendTextToTerminal', req as Record<string, unknown>),
        injectNodesIntoTerminal: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'injectNodesIntoTerminal', req as Record<string, unknown>),
        getUnseenNodesForTerminal: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'getUnseenNodesForTerminal', req as Record<string, unknown>),
        updateTerminalIsDone: patchTerminalRecord('done'),
        updateTerminalPinned: patchTerminalRecord('pinned'),
        updateTerminalMinimized: patchTerminalRecord('minimized'),
        updateTerminalActivityState: patchTerminalRecord('activity'),
        removeTerminalFromRegistry: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'removeTerminalFromRegistry', req as Record<string, unknown>),
        closeAgent: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'closeHeadlessAgent', req as Record<string, unknown>),
        closeHeadlessAgent: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'closeHeadlessAgent', req as Record<string, unknown>),
        getHeadlessAgentOutput: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'getHeadlessAgentOutput', req as Record<string, unknown>),
        listUnclaimedTmuxSessions: () =>
            callVtdRpc(vtdUrl, vtdToken, 'listUnclaimedTmuxSessions', {}),
        refreshUnclaimedTmuxSessions: () =>
            callVtdRpc(vtdUrl, vtdToken, 'refreshUnclaimedTmuxSessions', {}),
        attachUnclaimedTmuxSession: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'attachUnclaimedTmuxSession', req as Record<string, unknown>),
        killUnclaimedTmuxSession: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'killUnclaimedTmuxSession', req as Record<string, unknown>),
        refreshRecoverySessions: () =>
            callVtdRpc(vtdUrl, vtdToken, 'discoverRecoverableAgentSessions', {}),
        resumeRecoverySession: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'resumeRecoverySession', req as Record<string, unknown>),
        forkRecoverySession: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'forkRecoverySession', req as Record<string, unknown>),
        removeRecoverySession: (req: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'removeRecoverySession', req as Record<string, unknown>),
        askQuery: () => Promise.resolve(''),
        askModeCreateAndSpawn: () => Promise.resolve(null),
        getMetrics: () => callVtdRpc(vtdUrl, vtdToken, 'metrics.getMetrics', {}),
        getUsageData: () => Promise.resolve(null),
        refreshClaudeUsageHeadless: () => Promise.resolve(),
        openClaudeUsage: () => Promise.resolve(),
        openCodexStatus: () => Promise.resolve(),
        runAgentOnSelectedNodes: () => Promise.resolve(),
        syncRendererSessionStateWithDaemon: () => Promise.resolve(),

        // Browser-unsupported native operations
        showFolderPicker: () => unsupported('showFolderPicker'),
        createNewProject: () => unsupported('createNewProject'),
        scanForProjects: () => Promise.resolve([]),
        getDefaultSearchDirectories: () => Promise.resolve([]),
        loadProjects: () => Promise.resolve([]),
        saveProject: () => Promise.resolve(),
        removeProject: () => Promise.resolve(),
        saveClipboardImage: () => unsupported('saveClipboardImage'),
        readImageAsDataUrl: () => unsupported('readImageAsDataUrl'),
        checkMicrophonePermission: () => Promise.resolve('denied' as const),
        requestMicrophonePermission: () => Promise.resolve('denied' as const),
        openMicrophoneSettings: () => Promise.resolve(),
        // Worktrees — VTD owns the git plumbing. The HostAPI contract passes a
        // repoRoot (an Electron artifact), but the daemon resolves the repo root
        // from its OWN loaded project, so the browser-supplied path is ignored:
        // the gateway never runs git against a client-controlled path.
        listWorktrees: () => vtdListWorktrees(vtdUrl, vtdToken),
        createWorktree: (_repoRoot: string, worktreeName: string) =>
            vtdCreateWorktree(vtdUrl, vtdToken, worktreeName),
        generateWorktreeName: (nodeTitle: string) =>
            vtdGenerateWorktreeName(vtdUrl, vtdToken, nodeTitle),
        removeWorktree: (_repoRoot: string, worktreePath: string, force?: boolean) =>
            vtdRemoveWorktree(vtdUrl, vtdToken, worktreePath, force ?? false),
        getRemoveWorktreeCommand: (worktreePath: string, force?: boolean) =>
            vtdRemoveWorktreeCommand(vtdUrl, vtdToken, worktreePath, force ?? false),
        getStarredFolders: () => Promise.resolve([]),
        addStarredFolder: () => Promise.resolve(),
        removeStarredFolder: () => Promise.resolve(),
        isStarred: () => Promise.resolve(false),
        copyNodeToFolder: () => Promise.resolve(),
        listWorkflows: () => Promise.resolve([]),
        readSkillFile: () => Promise.resolve(''),
        readSkillFileSummary: () => Promise.resolve(''),
        prettySetupAppForElectronDebugging: () => Promise.resolve(),
        views: {
            list: () => vtdListViews(vtdUrl, vtdToken),
            activate: (viewId: string) => vtdActivateView(vtdUrl, vtdToken, viewId),
            clone: (srcViewId: string, name: string) => vtdCloneView(vtdUrl, vtdToken, srcViewId, name),
            delete: (viewId: string) => vtdDeleteView(vtdUrl, vtdToken, viewId),
        },
        __debugLockSSE: () => Promise.resolve(),
        __debugUnlockSSE: () => Promise.resolve(),
        __debugStopDaemonGraphSync: () => Promise.resolve(),
    } as unknown as Promisify<typeof mainAPI>

    return {
        capabilities: BROWSER_CAPABILITIES,
        main,
        onWatchingStarted: (cb) => addListener('watching-started', cb as Listener),
        onProjectSwitching: (cb) => addListener('project:switching', cb as Listener),
        onProjectReady: (cb) => addListener('project:ready', cb as Listener),
        onProjectLost: (cb) => addListener('project:lost', cb as Listener),
        onViewSwitched: (cb) => addListener('view:switched', cb as Listener),
        removeAllListeners: (channel) => channelListeners.delete(channel),

        terminal: {
            attach: (terminalId) => terminalRuntime.attach(vtdUrl, vtdToken, terminalId),
            onData: (handle, listener) => terminalRuntime.onData(handle, listener),
            onStatus: (handle, listener) => terminalRuntime.onStatus(handle, listener),
            write: (handle, data) => Promise.resolve(terminalRuntime.write(handle, data)),
            resize: (handle, cols, rows) => Promise.resolve(terminalRuntime.resize(handle, cols, rows)),
            scroll: (handle, dir, lines) => Promise.resolve(terminalRuntime.scroll(handle, dir, lines)),
            detach: (handle) => Promise.resolve(terminalRuntime.detach(handle)),
            rehydrate: () => Promise.resolve(),
        },

        events: {
            on: (topic: TopicName, listener: (frame: EventFrame | GapFrame) => void) =>
                addListener('vt:events', (frame) => {
                    if ((frame as EventFrame | GapFrame).topic === topic) listener(frame as EventFrame | GapFrame)
                }),
            onConnectionState: (listener: (state: ConnectionState) => void) =>
                addListener('vt:events:connection', listener as Listener),
            resnapshot: (_topic: TopicName): Promise<void> => resnapshotGraph(),
        },

        onBackendLog: (cb) => { addListener('backend-log', cb as Listener) },

        graph: {
            getCurrentProjectedGraph: () => vtdGetProjectedGraph(vtdUrl, vtdToken),
            onProjectedGraphUpdate: (cb) => addListener('graph:projectedGraphUpdate', cb as Listener),
            onGraphClear: (cb) => addListener('graph:clear', cb as Listener),
        },

        invoke: (_channel: string, ..._args: unknown[]): Promise<unknown> =>
            Promise.reject(new Error('[browserRuntime] invoke() is Electron-only')),
        on: (channel: string, listener: Listener) => { addListener(channel, listener) },
        off: (channel: string, listener: Listener) => {
            channelListeners.get(channel)?.delete(listener)
        },
    }
}
