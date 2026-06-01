// Browser-mode ElectronAPI adapter.
// Implements the ElectronAPI contract from webapp/src/shell/electron.d.ts by
// talking directly to VTD (JSON-RPC) and graphd (REST/SSE). Must be installed
// on window.electronAPI BEFORE React bootstraps so App.tsx's electronReady
// check fires on the first poll.

import type {NodeDefinition} from 'cytoscape'
import type {ElectronAPI, Promisify} from '@/shell/electron'
import {collectNodePositions} from '@/shell/edge/UI-edge/graph/collectNodePositions'
import type {mainAPI} from '@/shell/edge/main/runtime/api'
import type {ProjectedGraph} from '@vt/graph-state/contract'
import type {Graph, GraphDelta} from '@vt/graph-model/graph'
import type {ConnectionState, EventFrame, GapFrame, TopicName} from '@vt/vt-daemon/transport/eventTypes'
import type {ProjectState} from '@vt/graph-db-protocol'
import type {VTSettings} from '@vt/graph-model/settings'
import type {BrowserDaemonConfig} from './browserConfig'
import {
    graphdApplyDelta,
    graphdCreateContextNode,
    graphdFindFile,
    graphdGetGraph,
    graphdGetNode,
    graphdGetProject,
    graphdGetProjectedGraph,
    graphdRedo,
    graphdSavePositions,
    graphdSubscribeSessionEvents,
    graphdUndo,
    graphdWriteMarkdownFile,
} from './graphdFetch'
import {callVtdRpc, vtdGetSettings, vtdSubscribeEvents, vtdSubscribeTerminalRegistry} from './vtdRpc'
import {
    attachBrowserTerminal,
    detachTerminal,
    onBrowserTerminalData,
    onBrowserTerminalStatus,
    resizeTerminal,
    scrollTerminal,
    writeTerminal,
} from './browserTerminal'

type Listener = (...args: unknown[]) => void
const channelListeners = new Map<string, Set<Listener>>()

function emit(channel: string, ...args: unknown[]): void {
    for (const l of channelListeners.get(channel) ?? []) l(...args)
}

function addListener(channel: string, listener: Listener): () => void {
    let set = channelListeners.get(channel)
    if (!set) { set = new Set(); channelListeners.set(channel, set) }
    set.add(listener)
    return () => set!.delete(listener)
}

function unsupported(name: string): never {
    throw new Error(`[browserRuntime] ${name} is not supported in browser mode`)
}

function noop(): void {}

export function buildBrowserRuntime(cfg: BrowserDaemonConfig, sessionId: string): ElectronAPI {
    const {vtdUrl, vtdToken, graphdUrl, projectPath} = cfg
    const currentSessionId = sessionId

    // ── graph subscriptions ─────────────────────────────────────────────────
    let graphdSseCleanup: (() => void) | null = null

    function startGraphdSse(): void {
        graphdSseCleanup?.()
        graphdSseCleanup = graphdSubscribeSessionEvents(
            graphdUrl, currentSessionId,
            (eventName, data) => {
                // graphd emits the projected graph under the `projectedGraph` event
                // name; the data IS the ProjectedGraph (no wrapping type field).
                if (eventName !== 'projectedGraph') return
                try {
                    emit('graph:projectedGraphUpdate', JSON.parse(data) as ProjectedGraph)
                } catch { /* malformed event */ }
            },
            (err) => console.error('[browserRuntime] graphd SSE error:', err),
        )
    }

    startGraphdSse()

    // ── VTD /events WS ──────────────────────────────────────────────────────
    vtdSubscribeEvents(
        vtdUrl, vtdToken,
        (frame) => emit('vt:events', frame),
        (state) => emit('vt:events:connection', state),
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
            graphdApplyDelta(graphdUrl, currentSessionId, delta),
        applyGraphDeltaToDBThroughMemAndUIExposed: (delta: GraphDelta) =>
            graphdApplyDelta(graphdUrl, currentSessionId, delta),
        writeMarkdownFile: (absolutePath: string, body: string, editorId: string) =>
            graphdWriteMarkdownFile(graphdUrl, currentSessionId, absolutePath, body, editorId),
        getGraph: (): Promise<Graph> => graphdGetGraph(graphdUrl),
        getProjectedGraph: (): Promise<ProjectedGraph> =>
            graphdGetProjectedGraph(graphdUrl, currentSessionId),
        getNode: (nodeId: string): Promise<unknown> => graphdGetNode(graphdUrl, nodeId),
        reconcileGraphWithDisk: (): Promise<void> =>
            callVtdRpc(vtdUrl, vtdToken, 'reconcileGraphWithDisk', {}),
        collapseFolderThroughDaemon: (p: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'collapseFolderThroughDaemon', p as Record<string, unknown>),
        expandFolderThroughDaemon: (p: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'expandFolderThroughDaemon', p as Record<string, unknown>),
        setFolderStateThroughDaemon: (p: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'setFolderStateThroughDaemon', p as Record<string, unknown>),
        // cy.nodes().jsons() is a NodeDefinition[]; graphd's /graph/write-positions
        // wants {positions: {nodeId: {x, y}}}. Transform before posting.
        saveNodePositions: (payload: unknown) =>
            graphdSavePositions(graphdUrl, currentSessionId, {
                positions: collectNodePositions(payload as NodeDefinition[]),
            }),
        createContextNode: (payload: unknown) =>
            graphdCreateContextNode(graphdUrl, currentSessionId, payload),
        // graphd returns {nodeIds: string[]}; the ElectronAPI contract is a bare
        // string[] (callers do `new Set(result)`), so unwrap nodeIds.
        getPreviewContainedNodeIds: (nodeId: string): Promise<readonly string[]> =>
            fetch(`${graphdUrl}/graph/preview-contained-nodes/${encodeURIComponent(nodeId)}`)
                .then(r => r.json())
                .then((o: {nodeIds?: readonly string[]}) => o.nodeIds ?? []),
        performUndo: () => graphdUndo(graphdUrl, currentSessionId),
        performRedo: () => graphdRedo(graphdUrl, currentSessionId),
        findFileByName: (filename: string) => graphdFindFile(graphdUrl, filename),

        // Settings — fetch the resolved VTSettings from VTD (Electron parity).
        // Drives `agents` for the editor horizontal menu / agent-spawn control.
        loadSettings: (): Promise<VTSettings> => vtdGetSettings(vtdUrl, vtdToken),
        saveSettings: (): Promise<boolean> => Promise.resolve(true),

        // Project
        openProject: async (path: string) => {
            const [projectState, projGraph] = await Promise.all([
                graphdGetProject(graphdUrl) as Promise<ProjectState>,
                graphdGetProjectedGraph(graphdUrl, currentSessionId),
            ])
            emit('project:ready', {path: path || projectPath, sessionId: currentSessionId})
            return {
                projectState,
                sessionId: currentSessionId,
                initialProjectedGraph: projGraph,
            }
        },
        getStartupProjectHint: () => Promise.resolve({kind: 'open-folder', projectPath}),
        stopFileWatching: () => Promise.resolve(),
        shutdownGraphDaemon: () => Promise.resolve(),
        getWatchStatus: () => Promise.resolve({isWatching: false}),
        getProjectPaths: async () => {
            const ps = await graphdGetProject(graphdUrl) as ProjectState
            return {readPaths: ps.readPaths ?? [], writeFolderPath: ps.writeFolderPath ?? ''}
        },
        getReadPaths: async () => {
            const ps = await graphdGetProject(graphdUrl) as ProjectState
            return ps.readPaths ?? []
        },
        getWriteFolderPath: async () => {
            const ps = await graphdGetProject(graphdUrl) as ProjectState
            return ps.writeFolderPath ?? ''
        },
        setWriteFolderPath: (p: {path: string}) =>
            fetch(`${graphdUrl}/project/write-path`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({path: p.path}),
            }).then(noop),
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
        updateTerminalIsDone: (id: string, v: boolean) =>
            callVtdRpc(vtdUrl, vtdToken, 'patchTerminalRecord', {terminalId: id, patch: {kind: 'done', value: v}}),
        updateTerminalPinned: (id: string, v: boolean) =>
            callVtdRpc(vtdUrl, vtdToken, 'patchTerminalRecord', {terminalId: id, patch: {kind: 'pinned', value: v}}),
        updateTerminalMinimized: (id: string, v: boolean) =>
            callVtdRpc(vtdUrl, vtdToken, 'patchTerminalRecord', {terminalId: id, patch: {kind: 'minimized', value: v}}),
        updateTerminalActivityState: (id: string, v: unknown) =>
            callVtdRpc(vtdUrl, vtdToken, 'patchTerminalRecord', {terminalId: id, patch: {kind: 'activity', value: v}}),
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
        listWorktrees: () => Promise.resolve([]),
        createWorktree: () => unsupported('createWorktree'),
        generateWorktreeName: () => Promise.resolve(''),
        removeWorktree: () => unsupported('removeWorktree'),
        getRemoveWorktreeCommand: () => Promise.resolve(''),
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
            list: () =>
                fetch(`${graphdUrl}/project/views`).then(r => r.json()),
            activate: (req: unknown) =>
                fetch(`${graphdUrl}/project/views/${(req as {viewId: string}).viewId}/activate`, {method: 'POST'}).then(r => r.json()),
            clone: (req: unknown) =>
                fetch(`${graphdUrl}/project/views/${(req as {viewId: string}).viewId}/clone`, {method: 'POST'}).then(r => r.json()),
            delete: (req: unknown) =>
                fetch(`${graphdUrl}/project/views/${(req as {viewId: string}).viewId}`, {method: 'DELETE'}).then(r => r.json()),
        },
        __debugLockSSE: () => Promise.resolve(),
        __debugUnlockSSE: () => Promise.resolve(),
        __debugStopDaemonGraphSync: () => Promise.resolve(),
    } as unknown as Promisify<typeof mainAPI>

    return {
        main,
        onWatchingStarted: (cb) => addListener('watching-started', cb as Listener),
        onProjectSwitching: (cb) => addListener('project:switching', cb as Listener),
        onProjectReady: (cb) => addListener('project:ready', cb as Listener),
        onProjectLost: (cb) => addListener('project:lost', cb as Listener),
        onViewSwitched: (cb) => addListener('view:switched', cb as Listener),
        removeAllListeners: (channel) => channelListeners.delete(channel),

        terminal: {
            attach: (terminalId) => attachBrowserTerminal(vtdUrl, vtdToken, terminalId),
            onData: (handle, listener) => onBrowserTerminalData(handle, listener),
            onStatus: (handle, listener) => onBrowserTerminalStatus(handle, listener),
            write: (handle, data) => Promise.resolve(writeTerminal(handle, data)),
            resize: (handle, cols, rows) => Promise.resolve(resizeTerminal(handle, cols, rows)),
            scroll: (handle, dir, lines) => Promise.resolve(scrollTerminal(handle, dir, lines)),
            detach: (handle) => Promise.resolve(detachTerminal(handle)),
            rehydrate: () => Promise.resolve(),
        },

        events: {
            on: (topic: TopicName, listener: (frame: EventFrame | GapFrame) => void) =>
                addListener('vt:events', (frame) => {
                    if ((frame as EventFrame | GapFrame).topic === topic) listener(frame as EventFrame | GapFrame)
                }),
            onConnectionState: (listener: (state: ConnectionState) => void) =>
                addListener('vt:events:connection', listener as Listener),
            resnapshot: (_topic: TopicName): Promise<void> => {
                startGraphdSse()
                return Promise.resolve()
            },
        },

        onBackendLog: (cb) => { addListener('backend-log', cb as Listener) },

        graph: {
            getCurrentProjectedGraph: () => graphdGetProjectedGraph(graphdUrl, currentSessionId),
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
