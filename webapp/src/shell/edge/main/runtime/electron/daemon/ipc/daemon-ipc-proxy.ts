import { buildFolderTree, getCallbacks, toAbsolutePath, type DirectoryEntry, type FolderTreeNode, type Graph, type GraphDelta, type GraphNode } from '@vt/graph-model'
import { getDirectoryTree } from '@/shell/edge/main/graph/watch_folder/folderScanning'
import type { FolderState, GraphDbClient, LiveStateSnapshot, VaultState, ViewRecord } from '@vt/graph-db-client'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import type { SerializedState, State } from '@vt/graph-state'

import { getCurrentLiveState, rootsWereExplicitlySet } from '@/shell/edge/main/runtime/state/live-state-store'
import { uiAPI } from '@/shell/edge/main/runtime/ui-api-proxy'

import { callDaemon } from '../lifecycle/graph-daemon'
import { getNormalizedDaemonGraph } from '../queries/daemon-graph-normalization'
import { subscribeToDaemonSSE } from '../sync/daemon-sse-subscription'
import { getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'
import { buildFolderTreeSyncPayload, type FolderTreeSyncPayload } from '../sync/daemon-folder-tree-sync'

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
  if (currentRendererSession?.baseUrl === client.baseUrl) {
    subscribeRendererSessionToDaemon(client, currentRendererSession.sessionId)
    return currentRendererSession.sessionId
  }

  const created: { sessionId: string } = await client.createSession()
  currentRendererSession = {
    baseUrl: client.baseUrl,
    sessionId: created.sessionId,
  }
  subscribeRendererSessionToDaemon(client, created.sessionId)
  return created.sessionId
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
  const mainWindow: Electron.BrowserWindow | null = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return
  }

  const treePayload: FolderTreeSyncPayload = await buildFolderTreeSyncPayload(vaultState, nextGraph)
  uiAPI.syncVaultState({
    readPaths: vaultState.readPaths,
    starredFolders: treePayload.starredFolders,
    writePath: vaultState.writePath,
  })

  if (treePayload.rootTree) {
    uiAPI.syncFolderTree(treePayload.rootTree)
  }

  uiAPI.syncStarredFolderTrees(treePayload.starredTrees)
  uiAPI.syncExternalFolderTrees(treePayload.externalTrees)
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
  const sessionId: string = await getOrCreateRendererSession(client)

  if (localState.selection.size > 0) {
    await client.setSelection(sessionId, {
      mode: 'replace',
      nodeIds: sortStrings([...localState.selection]),
    })
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

  if (
    Object.keys(layoutUpdate).length > 0
    || !sameStringSet(new Set<string>(), localState.selection)
    || !samePan(undefined, localState.layout.pan)
  ) {
    await client.updateLayout(sessionId, layoutUpdate)
  }

  return sessionId
}

async function buildSerializedRoots(
  graph: Graph,
  vaultState: VaultState,
  loadedRoots: ReadonlySet<string>,
): Promise<LiveStateSnapshot['roots']> {
  try {
    const rootEntry: DirectoryEntry = await getDirectoryTree(vaultState.vaultPath)
    const rootTree: FolderTreeNode = buildFolderTree(
      rootEntry,
      new Set(loadedRoots),
      toAbsolutePath(vaultState.writePath),
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
  return await callDaemon(async (client) => {
    const vaultState: VaultState = await mutate(client)
    const nextGraph: Graph = await getNormalizedDaemonGraph(client)

    await syncRendererFromDaemon(client, nextGraph, vaultState)
    return vaultState
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
  await callDaemon(async (client) => {
    const sessionId: string = await getOrCreateRendererSession(client)
    await client.applyGraphDelta(delta as unknown[], { recordForUndo, sessionId })
  })
}

export async function postDeltaThroughDaemonWithEditors(
  delta: GraphDelta,
  recordForUndo: boolean = true,
): Promise<void> {
  await postDeltaThroughDaemon(delta, recordForUndo)
  getCallbacks().onFloatingEditorUpdate?.(delta)
}

export async function postWriteMarkdownFileThroughDaemon(
  absolutePath: string,
  body: string,
  editorId: string,
): Promise<{ ok: true; absolutePath: string; preservedSuffix: string | null }> {
  return await callDaemon(async (client) => {
    return await client.writeMarkdownFile(absolutePath, body, editorId)
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
    return await callDaemon(async (client) => {
      const localState: State = await getCurrentLiveState()
      const sessionId: string = await syncRendererSessionState(client, localState)
      const snapshot: LiveStateSnapshot = await client.getSessionState(sessionId)
      const vaultState: VaultState = await client.getVault()

      if (rootsWereExplicitlySet() || localState.roots.loaded.size > 0) {
        snapshot.roots = await buildSerializedRoots(
          await getNormalizedDaemonGraph(client),
          vaultState,
          localState.roots.loaded,
        )
      }

      if (localState.layout.fit !== undefined) {
        snapshot.layout.fit = localState.layout.fit
      }
      snapshot.meta.revision = localState.meta.revision

      return snapshot
    })
  } catch {
    return null
  }
}

export async function syncRendererSessionStateWithDaemon(): Promise<string> {
  return await callDaemon(async (client) => {
    const localState: State = await getCurrentLiveState()
    return await syncRendererSessionState(client, localState)
  })
}

function publishProjectedGraphToRenderer(graph: unknown): void {
  const mainWindow: Electron.BrowserWindow | null = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return

  mainWindow.webContents.send('graph:projectedGraphUpdate', graph)
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
  return await callDaemon(async (client) => {
    const sessionId: string = await syncRendererSessionState(client, await getCurrentLiveState())
    const folderPath: string = folderId.length > 1 && folderId.endsWith('/')
      ? folderId.slice(0, -1)
      : folderId
    await client.setFolderState(sessionId, folderPath, state)
    const graph: unknown = await client.getProjectedGraph(sessionId)
    const mainWindow: Electron.BrowserWindow | null = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('graph:projectedGraphUpdate', graph)
    }
    return graph
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

export async function setWritePathThroughDaemon(path: string): Promise<VaultState> {
  return await runVaultMutation(`setWritePath:${path}`, (client) => client.setWritePath(path))
}

export async function refreshMainGraphFromDaemon(_vault?: string): Promise<void> {
  await callDaemon((client) => syncMainGraphFromDaemonClient(client))
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
