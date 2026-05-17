import { buildFolderTree, getCallbacks, toAbsolutePath, type DirectoryEntry, type FolderTreeNode, type Graph, type GraphDelta, type GraphNode } from '@vt/graph-model'
import { getDirectoryTree } from '@/shell/edge/main/graph/watch_folder/folderScanning'
import type { FolderState, GraphDbClient, LiveStateSnapshot, VaultState, ViewRecord } from '@vt/graph-db-client'
import type { SerializedState, State } from '@vt/graph-state'

import { getCurrentLiveState, rootsWereExplicitlySet } from '@/shell/edge/main/runtime/state/live-state-store'
import { uiAPI } from '@/shell/edge/main/runtime/ui-api-proxy'

import { callDaemon } from './graph-daemon'
import { getNormalizedDaemonGraph } from './daemon-graph-normalization'
import { subscribeToDaemonSSE } from './daemon-sse-subscription'
import { getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'
import { buildFolderTreeSyncPayload, type FolderTreeSyncPayload } from './daemon-folder-tree-sync'

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
  if (!mainWindow || mainWindow.isDestroyed()) return

  subscribeToDaemonSSE(sessionId, client.baseUrl, mainWindow)
}

async function createRendererSession(client: GraphDbClient): Promise<string> {
  const created: { sessionId: string } = await client.createSession()
  subscribeRendererSessionToDaemon(client, created.sessionId)
  return created.sessionId
}

async function syncRendererFromDaemon(
  client: GraphDbClient,
  nextGraph: Graph,
  vaultState: VaultState,
): Promise<void> {
  const mainWindow: Electron.BrowserWindow | null = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    const sessionId: string = await createRendererSession(client)
    mainWindow.webContents.send(
      'graph:projectedGraphUpdate',
      await client.getProjectedGraph(sessionId),
    )
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

async function syncRendererSessionState(
  client: GraphDbClient,
  localState: State,
): Promise<string> {
  const sessionId: string = await createRendererSession(client)

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
    const sessionId: string = await createRendererSession(client)
    return await client.getProjectedGraph(sessionId)
  })
}

export async function postDeltaThroughDaemon(
  delta: GraphDelta,
  recordForUndo: boolean = true,
): Promise<void> {
  await callDaemon(async (client) => {
    const sessionId: string = await createRendererSession(client)
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

export async function collapseFolderThroughDaemon(folderId: string): Promise<unknown> {
  return await callDaemon(async (client) => {
    const sessionId: string = await createRendererSession(client)
    return await client.collapse(sessionId, folderId)
  })
}

export async function expandFolderThroughDaemon(folderId: string): Promise<unknown> {
  return await callDaemon(async (client) => {
    const sessionId: string = await createRendererSession(client)
    return await client.expand(sessionId, folderId)
  })
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
    return await client.getProjectedGraph(sessionId)
  })
}

export async function addReadPathThroughDaemon(path: string): Promise<VaultState> {
  return await runVaultMutation(`addReadPath:${path}`, (client) => client.addReadPath(path))
}

export async function removeReadPathThroughDaemon(path: string): Promise<VaultState> {
  return await runVaultMutation(`removeReadPath:${path}`, (client) => client.removeReadPath(path))
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
