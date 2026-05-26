import { buildFolderTree, getCallbacks, toAbsolutePath, type DirectoryEntry, type FolderTreeNode, type Graph, type GraphDelta, type GraphNode } from '@vt/graph-model'
import { getDirectoryTree } from '@/shell/edge/main/graph/watch_folder/folderScanning'
import { tracing } from '@vt/observability'
import type { FolderState, GraphDbClient, LiveStateSnapshot, VaultState, ViewRecord } from '@vt/graph-db-client'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import type { SerializedState, State } from '@vt/graph-state'

import { getCurrentLiveState, rootsWereExplicitlySet } from '@/shell/edge/main/runtime/state/live-state-store'
import { uiAPI } from '@/shell/edge/main/runtime/ui-api-proxy'

import { callDaemon } from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon'
import { getNormalizedDaemonGraph } from '@/shell/edge/main/runtime/electron/daemon/queries/daemon-graph-normalization'
import { subscribeToDaemonSSE } from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-sse-subscription'
import { getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'
import { buildFolderTreeSyncPayload, type FolderTreeSyncPayload } from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-folder-tree-sync'

function graphNodeCount(graph: Graph): number {
  return Object.keys(graph.nodes).length
}

function recordCount(value: Record<string, unknown>): number {
  return Object.keys(value).length
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) {
    return false
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false
    }
  }

  return true
}

function samePan(
  left: State['layout']['pan'],
  right: State['layout']['pan'],
): boolean {
  if (left === undefined || right === undefined) {
    return left === right
  }

  return left.x === right.x && left.y === right.y
}

function subscribeRendererSessionToDaemon(client: GraphDbClient, sessionId: string): void {
  const mainWindow: Electron.BrowserWindow | null = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return

  subscribeToDaemonSSE(sessionId, client.baseUrl, mainWindow)
}

let currentRendererSession: {
  readonly baseUrl: string
  readonly sessionId: string
} | null = null

export async function getOrCreateRendererSession(client: GraphDbClient): Promise<string> {
  return await tracing.span('electron.renderer-session.ensure', async (span) => {
    span.setAttribute('daemon.base_url', client.baseUrl)
    if (currentRendererSession?.baseUrl === client.baseUrl) {
      span.setAttribute('renderer_session.cached', true)
      subscribeRendererSessionToDaemon(client, currentRendererSession.sessionId)
      span.addEvent('electron.renderer-session.sse-subscribed')
      return currentRendererSession.sessionId
    }

    span.setAttribute('renderer_session.cached', false)
    span.addEvent('electron.renderer-session.create.start')
    const created: { sessionId: string } = await client.createSession()
    currentRendererSession = {
      baseUrl: client.baseUrl,
      sessionId: created.sessionId,
    }
    span.setAttribute('renderer_session.id', created.sessionId)
    span.addEvent('electron.renderer-session.create.complete')
    subscribeRendererSessionToDaemon(client, created.sessionId)
    span.addEvent('electron.renderer-session.sse-subscribed')
    return created.sessionId
  })
}

/** Test-only: clear the cached renderer session between test cases. */
export function __resetRendererSessionForTests(): void {
  currentRendererSession = null
}

async function syncRendererFromDaemon(
  client: GraphDbClient,
  nextGraph: Graph,
  vaultState: VaultState,
): Promise<void> {
  await tracing.span('electron.renderer.sync-from-daemon', async (span) => {
    span.setAttribute('daemon.base_url', client.baseUrl)
    span.setAttribute('graph.node.count', graphNodeCount(nextGraph))
    span.setAttribute('vault.read_path.count', vaultState.readPaths.length)
    span.setAttribute('vault.write_folder', vaultState.writeFolder)

    const mainWindow: Electron.BrowserWindow | null = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      span.addEvent('electron.renderer.sync.skipped', {
        reason: 'main-window-unavailable',
      })
      return
    }

    span.addEvent('electron.renderer.folder-tree-build.start')
    const treePayload: FolderTreeSyncPayload = await buildFolderTreeSyncPayload(vaultState, nextGraph)
    span.setAttribute('folder_tree.has_root', treePayload.rootTree !== null)
    span.setAttribute('folder_tree.starred.count', treePayload.starredFolders.length)
    span.setAttribute('folder_tree.starred_tree.count', recordCount(treePayload.starredTrees))
    span.setAttribute('folder_tree.external_tree.count', recordCount(treePayload.externalTrees))
    span.addEvent('electron.renderer.folder-tree-build.complete')

    uiAPI.syncVaultState({
      readPaths: vaultState.readPaths,
      starredFolders: treePayload.starredFolders,
      writeFolder: vaultState.writeFolder,
    })

    if (treePayload.rootTree) {
      uiAPI.syncFolderTree(treePayload.rootTree)
    }

    uiAPI.syncStarredFolderTrees(treePayload.starredTrees)
    uiAPI.syncExternalFolderTrees(treePayload.externalTrees)
    span.addEvent('electron.renderer.sync.sent')
  })
}

async function syncMainGraphFromDaemonClient(client: GraphDbClient): Promise<void> {
  const nextGraph: Graph = await getNormalizedDaemonGraph(client)
  const vaultState: VaultState = await client.getVault()
  await syncRendererFromDaemon(client, nextGraph, vaultState)
}

export async function syncRendererSessionState(
  client: GraphDbClient,
  localState: State,
): Promise<string> {
  return await tracing.span('electron.renderer-session.sync-state', async (span) => {
    span.setAttribute('state.selection.count', localState.selection.size)
    span.setAttribute('state.layout.has_pan', localState.layout.pan !== undefined)
    span.setAttribute('state.layout.has_zoom', localState.layout.zoom !== undefined)
    const sessionId: string = await getOrCreateRendererSession(client)
    span.setAttribute('renderer_session.id', sessionId)

    if (localState.selection.size > 0) {
      span.addEvent('electron.renderer-session.selection-update.start')
      await client.setSelection(sessionId, {
        mode: 'replace',
        nodeIds: sortStrings([...localState.selection]),
      })
      span.addEvent('electron.renderer-session.selection-update.complete')
    }

    const layoutUpdate: {
      pan?: { x: number; y: number }
      zoom?: number
    } = {}

    if (localState.layout.pan) {
      layoutUpdate.pan = localState.layout.pan
    }
    if (localState.layout.zoom !== undefined) {
      layoutUpdate.zoom = localState.layout.zoom
    }

    const shouldUpdateLayout =
      Object.keys(layoutUpdate).length > 0
      || !sameStringSet(new Set<string>(), localState.selection)
      || !samePan(undefined, localState.layout.pan)
    span.setAttribute('state.layout.update_needed', shouldUpdateLayout)

    if (shouldUpdateLayout) {
      span.addEvent('electron.renderer-session.layout-update.start')
      await client.updateLayout(sessionId, layoutUpdate)
      span.addEvent('electron.renderer-session.layout-update.complete')
    }

    return sessionId
  })
}

async function buildSerializedRoots(
  graph: Graph,
  vaultState: VaultState,
  loadedRoots: ReadonlySet<string>,
): Promise<LiveStateSnapshot['roots']> {
  try {
    const rootEntry: DirectoryEntry = await getDirectoryTree(vaultState.projectRoot)
    const rootTree: FolderTreeNode = buildFolderTree(
      rootEntry,
      new Set(loadedRoots),
      toAbsolutePath(vaultState.writeFolder),
      new Set(Object.keys(graph.nodes)),
    )
    return {
      folderTree: [rootTree] as SerializedState['roots']['folderTree'],
    }
  } catch {
    return {
      folderTree: [],
    }
  }
}

const inflightVaultMutations: Map<string, Promise<VaultState>> = new Map()

async function runVaultMutation(
  key: string,
  mutate: (client: GraphDbClient) => Promise<VaultState>,
): Promise<VaultState> {
  const existing: Promise<VaultState> | undefined = inflightVaultMutations.get(key)
  if (existing) return existing

  const pending: Promise<VaultState> = doRunVaultMutation(mutate)
  inflightVaultMutations.set(key, pending)
  try {
    return await pending
  } finally {
    if (inflightVaultMutations.get(key) === pending) {
      inflightVaultMutations.delete(key)
    }
  }
}

async function doRunVaultMutation(
  mutate: (client: GraphDbClient) => Promise<VaultState>,
): Promise<VaultState> {
  return await tracing.span('electron.vault.mutation', async (span) => {
    return await callDaemon(async (client) => {
      span.setAttribute('daemon.base_url', client.baseUrl)
      span.addEvent('electron.vault.mutation.request.start')
      const vaultState: VaultState = await mutate(client)
      span.addEvent('electron.vault.mutation.request.complete')
      const nextGraph: Graph = await getNormalizedDaemonGraph(client)
      span.setAttribute('graph.node.count', graphNodeCount(nextGraph))

      await syncRendererFromDaemon(client, nextGraph, vaultState)
      return vaultState
    })
  })
}

export async function getGraphFromDaemon(): Promise<Graph> {
  return await callDaemon((client) => getNormalizedDaemonGraph(client))
}

export async function getProjectedGraphFromDaemon(): Promise<unknown> {
  return await callDaemon(async (client) => {
    const sessionId: string = await getOrCreateRendererSession(client)
    return await client.getProjectedGraph(sessionId)
  })
}

export async function getCurrentProjectedGraphFromDaemon(): Promise<ProjectedGraph> {
  return await callDaemon(async (client) => {
    const sessionId: string = await getOrCreateRendererSession(client)
    const graph: ProjectedGraph = await client.getProjectedGraph(sessionId) as ProjectedGraph
    return graph
  })
}

export async function postDeltaThroughDaemon(
  delta: GraphDelta,
  recordForUndo: boolean = true,
): Promise<void> {
  await tracing.span('electron.graph.post-delta', async (span) => {
    span.setAttribute('graph.delta.count', delta.length)
    span.setAttribute('graph.record_for_undo', recordForUndo)
    await callDaemon(async (client) => {
      span.setAttribute('daemon.base_url', client.baseUrl)
      const sessionId: string = await getOrCreateRendererSession(client)
      span.setAttribute('renderer_session.id', sessionId)
      span.addEvent('electron.graph.apply-delta.start')
      await client.applyGraphDelta(delta as unknown[], { recordForUndo, sessionId })
      span.addEvent('electron.graph.apply-delta.complete')
    })
  })
}

function mergeFloatingEditorDeltas(deltas: readonly GraphDelta[]): GraphDelta {
  return deltas.flatMap((delta) => delta)
}

function createFloatingEditorDeltaQueue(
  onFlush: (delta: GraphDelta) => void,
): {
  readonly enqueue: (delta: GraphDelta) => void
  readonly reset: () => void
} {
  const state: {
    pendingDeltas: GraphDelta[]
    flushScheduled: boolean
  } = {
    pendingDeltas: [],
    flushScheduled: false,
  }

  function flush(): void {
    state.flushScheduled = false
    const deltas: readonly GraphDelta[] = state.pendingDeltas
    state.pendingDeltas = []
    if (deltas.length === 0) return

    onFlush(mergeFloatingEditorDeltas(deltas))
  }

  return {
    enqueue(delta: GraphDelta): void {
      state.pendingDeltas = [...state.pendingDeltas, delta]
      if (state.flushScheduled) return

      state.flushScheduled = true
      queueMicrotask(flush)
    },
    reset(): void {
      state.pendingDeltas = []
      state.flushScheduled = false
    },
  }
}

const floatingEditorDeltaQueue = createFloatingEditorDeltaQueue((delta) => {
  getCallbacks().onFloatingEditorUpdate?.(delta)
})

/** Test-only: clear the microtask coalescer state between test cases. */
export function __resetFloatingEditorDeltaQueueForTests(): void {
  floatingEditorDeltaQueue.reset()
}

export async function postDeltaThroughDaemonWithEditors(
  delta: GraphDelta,
  recordForUndo: boolean = true,
): Promise<void> {
  await tracing.span('electron.graph.post-delta-with-editors', async (span) => {
    span.setAttribute('graph.delta.count', delta.length)
    await postDeltaThroughDaemon(delta, recordForUndo)
    span.addEvent('electron.graph.floating-editor-update.queued')
    floatingEditorDeltaQueue.enqueue(delta)
  })
}

export async function reconcileGraphWithDiskThroughDaemon(): Promise<GraphDelta> {
  return await tracing.span('electron.graph.reconcile-disk', async (span) => {
    return await callDaemon(async (client) => {
      span.setAttribute('daemon.base_url', client.baseUrl)
      span.addEvent('electron.graph.reconcile-disk.request.start')
      const delta = await client.reconcileGraphWithDisk() as GraphDelta
      span.setAttribute('graph.delta.count', delta.length)
      span.addEvent('electron.graph.reconcile-disk.request.complete')
      return delta
    })
  })
}

export async function postWriteMarkdownFileThroughDaemon(
  absolutePath: string,
  body: string,
  editorId: string,
): Promise<{ ok: true; absolutePath: string; preservedSuffix: string | null }> {
  return await tracing.span('electron.graph.write-markdown-file', async (span) => {
    span.setAttribute('file.request_path', absolutePath)
    span.setAttribute('editor.id', editorId)
    span.setAttribute('editor.body.size', body.length)
    return await callDaemon(async (client) => {
      span.setAttribute('daemon.base_url', client.baseUrl)
      span.addEvent('electron.graph.write-markdown-file.request.start')
      const result = await client.writeMarkdownFile(absolutePath, body, editorId)
      span.setAttribute('file.target_path', result.absolutePath)
      span.setAttribute('file.preserved_suffix.present', result.preservedSuffix !== null)
      span.setAttribute('file.preserved_suffix.size', result.preservedSuffix?.length ?? 0)
      span.addEvent('electron.graph.write-markdown-file.request.complete')
      return result
    })
  })
}

export async function getNodeFromDaemon(
  nodeId: string,
): Promise<GraphNode | undefined> {
  const graph: Graph = await getGraphFromDaemon()
  return graph.nodes[nodeId]
}

export async function getLiveStateSnapshotFromDaemon(): Promise<LiveStateSnapshot | null> {
  try {
    return await tracing.span('electron.live-state.snapshot-from-daemon', async (span) => {
      return await callDaemon(async (client) => {
        span.setAttribute('daemon.base_url', client.baseUrl)
        span.addEvent('electron.live-state.local-state.read.start')
        const localState: State = await getCurrentLiveState()
        span.setAttribute('state.selection.count', localState.selection.size)
        const sessionId: string = await syncRendererSessionState(client, localState)
        span.setAttribute('renderer_session.id', sessionId)
        const snapshot: LiveStateSnapshot = await client.getSessionState(sessionId)
        const vaultState: VaultState = await client.getVault()

        if (rootsWereExplicitlySet() || localState.roots.loaded.size > 0) {
          span.addEvent('electron.live-state.roots-build.start')
          snapshot.roots = await buildSerializedRoots(
            await getNormalizedDaemonGraph(client),
            vaultState,
            localState.roots.loaded,
          )
          span.addEvent('electron.live-state.roots-build.complete')
        }

        if (localState.layout.fit !== undefined) {
          snapshot.layout.fit = localState.layout.fit
        }
        snapshot.meta.revision = localState.meta.revision
        span.setAttribute('state.meta.revision', localState.meta.revision)

        return snapshot
      })
    })
  } catch {
    return null
  }
}

export async function syncRendererSessionStateWithDaemon(): Promise<string> {
  return await tracing.span('electron.renderer-session.sync-state-with-daemon', async (span) => {
    return await callDaemon(async (client) => {
      span.setAttribute('daemon.base_url', client.baseUrl)
      const localState: State = await getCurrentLiveState()
      span.setAttribute('state.selection.count', localState.selection.size)
      return await syncRendererSessionState(client, localState)
    })
  })
}

function publishProjectedGraphToRenderer(graph: unknown): void {
  tracing.syncSpan('electron.renderer.projected-graph.publish', (span) => {
    const mainWindow: Electron.BrowserWindow | null = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      span.addEvent('electron.renderer.projected-graph.publish.skipped', {
        reason: 'main-window-unavailable',
      })
      return
    }

    mainWindow.webContents.send('graph:projectedGraphUpdate', graph)
    span.addEvent('electron.renderer.projected-graph.publish.sent')
  })
}

export async function collapseFolderThroughDaemon(folderId: string): Promise<unknown> {
  const graph: unknown = await setFolderStateThroughDaemon(folderId, 'collapsed')
  publishProjectedGraphToRenderer(graph)
  return graph
}

export async function expandFolderThroughDaemon(folderId: string): Promise<unknown> {
  const graph: unknown = await setFolderStateThroughDaemon(folderId, 'expanded')
  publishProjectedGraphToRenderer(graph)
  return graph
}

export async function setFolderStateThroughDaemon(
  folderId: string,
  state: FolderState,
): Promise<unknown> {
  return await tracing.span('electron.folder-state.set-through-daemon', async (span) => {
    span.setAttribute('folder.id', folderId)
    span.setAttribute('folder.state', state)
    return await callDaemon(async (client) => {
      span.setAttribute('daemon.base_url', client.baseUrl)
      const sessionId: string = await syncRendererSessionState(client, await getCurrentLiveState())
      span.setAttribute('renderer_session.id', sessionId)
      const folderPath: string = folderId.length > 1 && folderId.endsWith('/')
        ? folderId.slice(0, -1)
        : folderId
      span.setAttribute('folder.path', folderPath)
      span.addEvent('electron.folder-state.set.start')
      await client.setFolderState(sessionId, folderPath, state)
      span.addEvent('electron.folder-state.set.complete')
      const graph: unknown = await client.getProjectedGraph(sessionId)
      const mainWindow: Electron.BrowserWindow | null = getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:projectedGraphUpdate', graph)
        span.addEvent('electron.renderer.projected-graph.publish.sent')
      } else {
        span.addEvent('electron.renderer.projected-graph.publish.skipped', {
          reason: 'main-window-unavailable',
        })
      }
      return graph
    })
  })
}

export async function addReadPathThroughDaemon(path: string): Promise<unknown> {
  const graph: unknown = await setFolderStateThroughDaemon(path, 'expanded')
  publishProjectedGraphToRenderer(graph)
  await refreshMainGraphFromDaemon()
  return graph
}

export async function removeReadPathThroughDaemon(path: string): Promise<unknown> {
  const graph: unknown = await setFolderStateThroughDaemon(path, 'hidden')
  publishProjectedGraphToRenderer(graph)
  await refreshMainGraphFromDaemon()
  return graph
}

export async function setWriteFolderThroughDaemon(path: string): Promise<VaultState> {
  return await runVaultMutation(`setWriteFolder:${path}`, (client) => client.setWriteFolder(path))
}

export async function refreshMainGraphFromDaemon(_vault?: string): Promise<void> {
  await tracing.span('electron.graph.refresh-main-from-daemon', async (span) => {
    await callDaemon(async (client) => {
      span.setAttribute('daemon.base_url', client.baseUrl)
      await syncMainGraphFromDaemonClient(client)
    })
  })
}

export async function listViewsThroughDaemon(): Promise<readonly ViewRecord[]> {
  return await callDaemon((client) => client.views.list())
}

export async function activateViewThroughDaemon(viewId: string): Promise<ViewRecord> {
  return await callDaemon(async (client) => {
    const result = await client.views.activate(viewId)
    const mainWindow: Electron.BrowserWindow | null = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('view:switched', { activeViewId: viewId })
    }
    return result
  })
}

export async function cloneViewThroughDaemon(srcViewId: string, dstName: string): Promise<ViewRecord> {
  return await callDaemon((client) => client.views.clone(srcViewId, dstName))
}

export async function deleteViewThroughDaemon(viewId: string): Promise<void> {
  return await callDaemon((client) => client.views.delete(viewId))
}
