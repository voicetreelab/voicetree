import { buildFolderTree, getCallbacks, toAbsolutePath, type DirectoryEntry, type FolderTreeNode, type Graph, type GraphDelta, type GraphNode } from '@vt/graph-model'
import path from 'node:path'
import { getDirectoryTree } from '@/shell/edge/main/graph/watch_folder/folderScanning'
import { syncMcpGraphDbServerState } from '@vt/voicetree-mcp'
import { getVaultConfigForDirectory } from '@vt/app-config/vault-config'
import type { VaultConfig } from '@vt/graph-model/settings'
import type { VaultState } from '@vt/graph-db-client'
import { hydrateState, type SerializedState, type State } from '@vt/graph-state'

import { getCurrentLiveState, rootsWereExplicitlySet } from '@/shell/edge/main/state/live-state-store'
import { uiAPI } from '@/shell/edge/main/ui-api-proxy'

import {
  ensureDaemonClientForVault,
  getActiveDaemonConnection,
  type CachedDaemonConnection,
} from './graph-daemon'
import { getNormalizedDaemonGraph } from './daemon-graph-normalization'
import { isLoadTimingActive, markLoadTiming } from '@/shell/edge/main/diagnostics/loadTiming'
import {
  isDaemonSSEActive,
  subscribeToDaemonSSE,
  unsubscribeFromDaemonSSE,
} from './daemon-sse-subscription'
import { getMainWindow } from '@/shell/edge/main/state/app-electron-state'
import { buildFolderTreeSyncPayload, type FolderTreeSyncPayload } from './daemon-folder-tree-sync'

type DaemonClient = Awaited<
  ReturnType<typeof ensureDaemonClientForVault>
>['client']
type CurrentDaemonConnection = {
  client: DaemonClient
  vault: string
}
type DesiredVaultState = Awaited<ReturnType<typeof getDesiredVaultStateForBootstrap>>

const MAIN_DAEMON_TIMEOUT_MS: number = 15_000

function resolveLocalWritePath(projectPath: string, writePath: string): string {
  return path.isAbsolute(writePath)
    ? writePath
    : path.join(projectPath, writePath)
}

async function getConfiguredWritePathForVault(vault: string): Promise<string | null> {
  const config: VaultConfig | undefined = await getVaultConfigForDirectory(vault)
  return config?.writePath ? resolveLocalWritePath(vault, config.writePath) : vault
}

type SessionSyncCache = {
  readonly collapseSet: ReadonlySet<string>
  readonly pan: State['layout']['pan']
  readonly selection: ReadonlySet<string>
  readonly sessionId: string
  readonly zoom: State['layout']['zoom']
}

let cachedVault: string | null = null
let rendererSessionId: string | null = null
let sessionSyncCache: SessionSyncCache | null = null

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

async function getCurrentVaultOrThrow(): Promise<string> {
  const activeConnection: CachedDaemonConnection | null = getActiveDaemonConnection()
  if (activeConnection) return activeConnection.vault
  throw new Error('Watched directory not initialized')
}

async function getDesiredVaultStateForBootstrap(vault: string): Promise<{
  readPaths: string[]
  writePath: string
}> {
  const writePath: string | null = await getConfiguredWritePathForVault(vault)

  return {
    readPaths: [],
    writePath: writePath ?? vault,
  }
}

function resetCachesForVault(vault: string): void {
  if (cachedVault === vault) {
    return
  }

  cachedVault = vault
  rendererSessionId = null
  sessionSyncCache = null
  unsubscribeFromDaemonSSE()
}

function subscribeRendererSessionToDaemon(client: DaemonClient, sessionId: string): void {
  if (isDaemonSSEActive()) return

  const mainWindow: Electron.BrowserWindow | null = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) return

  subscribeToDaemonSSE(sessionId, client.baseUrl, mainWindow)
}

async function getDaemonClientForCurrentVault(): Promise<{
  client: DaemonClient
  vault: string
}> {
  const vault: string = await getCurrentVaultOrThrow()
  resetCachesForVault(vault)

  const connection: CachedDaemonConnection = await ensureDaemonClientForVault(vault, {
    timeoutMs: MAIN_DAEMON_TIMEOUT_MS,
  })
  return { client: connection.client, vault }
}

async function syncRendererFromDaemon(
  client: DaemonClient,
  nextGraph: Graph,
  vaultState: VaultState,
): Promise<void> {
  const mainWindow: Electron.BrowserWindow | null = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    const sessionId: string = await ensureRendererSession(client)
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

async function syncMainGraphFromDaemonClient(client: DaemonClient): Promise<void> {
  const timingActive: boolean = isLoadTimingActive()
  if (timingActive) markLoadTiming('main:daemon-get-graph-start')
  const nextGraph: Graph = await getNormalizedDaemonGraph(client)
  if (timingActive) {
    markLoadTiming('main:daemon-get-graph-end', {
      nodeCount: Object.keys(nextGraph.nodes).length,
    })
  }
  const vaultState: VaultState = await client.getVault()

  if (timingActive) {
    markLoadTiming('main:graph-populated', {
      nodeCount: Object.keys(nextGraph.nodes).length,
    })
  }
  syncMcpGraphDbServerState(nextGraph, getActiveDaemonConnection()?.vault ?? null)
  await syncRendererFromDaemon(client, nextGraph, vaultState)
  if (timingActive) markLoadTiming('main:render-broadcast-sent')
}

async function ensureRendererSession(client: DaemonClient): Promise<string> {
  if (rendererSessionId) {
    try {
      await client.getSession(rendererSessionId)
      subscribeRendererSessionToDaemon(client, rendererSessionId)
      return rendererSessionId
    } catch {
      rendererSessionId = null
      sessionSyncCache = null
      unsubscribeFromDaemonSSE()
    }
  }

  const created: { sessionId: string } = await client.createSession()
  rendererSessionId = created.sessionId
  sessionSyncCache = {
    sessionId: created.sessionId,
    collapseSet: new Set(),
    selection: new Set(),
    pan: undefined,
    zoom: undefined,
  }
  subscribeRendererSessionToDaemon(client, created.sessionId)
  return created.sessionId
}

async function syncRendererSessionState(
  client: DaemonClient,
  localState: State,
): Promise<string> {
  const sessionId: string = await ensureRendererSession(client)
  const previous: SessionSyncCache = sessionSyncCache?.sessionId === sessionId
    ? sessionSyncCache
    : {
        sessionId,
        collapseSet: new Set<string>(),
        selection: new Set<string>(),
        pan: undefined,
        zoom: undefined,
      }

  if (!sameStringSet(previous.selection, localState.selection)) {
    await client.setSelection(sessionId, {
      mode: 'replace',
      nodeIds: sortStrings([...localState.selection]),
    })
  }

  if (
    previous.zoom !== localState.layout.zoom
    || !samePan(previous.pan, localState.layout.pan)
  ) {
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

    if (Object.keys(layoutUpdate).length > 0) {
      await client.updateLayout(sessionId, layoutUpdate)
    }
  }

  sessionSyncCache = {
    sessionId,
    collapseSet: new Set(localState.collapseSet),
    selection: new Set(localState.selection),
    pan: localState.layout.pan,
    zoom: localState.layout.zoom,
  }

  return sessionId
}

async function buildSerializedRoots(
  graph: Graph,
  vaultState: VaultState,
  loadedRoots: ReadonlySet<string>,
): Promise<SerializedState['roots']> {
  const loaded: string[] = sortStrings([...loadedRoots])

  try {
    const rootEntry: DirectoryEntry = await getDirectoryTree(vaultState.vaultPath)
    const rootTree: FolderTreeNode = buildFolderTree(
      rootEntry,
      new Set(loadedRoots),
      toAbsolutePath(vaultState.writePath),
      new Set(Object.keys(graph.nodes)),
    )
    return {
      loaded,
      folderTree: [rootTree] as SerializedState['roots']['folderTree'],
    }
  } catch {
    return {
      loaded,
      folderTree: [],
    }
  }
}

const inflightVaultMutations: Map<string, Promise<VaultState>> = new Map()

async function runVaultMutation(
  key: string,
  mutate: (client: DaemonClient) => Promise<VaultState>,
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
  mutate: (client: DaemonClient) => Promise<VaultState>,
): Promise<VaultState> {
  const { client }: CurrentDaemonConnection = await getDaemonClientForCurrentVault()
  const vaultState: VaultState = await mutate(client)
  const nextGraph: Graph = await getNormalizedDaemonGraph(client)

  await syncRendererFromDaemon(client, nextGraph, vaultState)
  return vaultState
}

export async function getGraphFromDaemon(): Promise<Graph> {
  const { client }: CurrentDaemonConnection = await getDaemonClientForCurrentVault()
  const graph: Graph = await getNormalizedDaemonGraph(client)
  syncMcpGraphDbServerState(graph, getActiveDaemonConnection()?.vault ?? null)
  return graph
}

export async function getProjectedGraphFromDaemon(): Promise<unknown> {
  const { client }: CurrentDaemonConnection = await getDaemonClientForCurrentVault()
  const sessionId: string = await ensureRendererSession(client)
  return await client.getProjectedGraph(sessionId)
}

export async function postDeltaThroughDaemon(delta: GraphDelta): Promise<void> {
  const { client }: CurrentDaemonConnection = await getDaemonClientForCurrentVault()
  const sessionId: string = await ensureRendererSession(client)
  await client.postDelta(delta as unknown[], sessionId)
}

export async function postDeltaThroughDaemonWithEditors(delta: GraphDelta): Promise<void> {
  await postDeltaThroughDaemon(delta)
  getCallbacks().onFloatingEditorUpdate?.(delta)
}

export async function getNodeFromDaemon(
  nodeId: string,
): Promise<GraphNode | undefined> {
  const graph: Graph = await getGraphFromDaemon()
  return graph.nodes[nodeId]
}

export async function getLiveStateSnapshotFromDaemon(): Promise<SerializedState | null> {
  if (!getActiveDaemonConnection()) return null
  const { client }: CurrentDaemonConnection = await getDaemonClientForCurrentVault()
  const localState: State = await getCurrentLiveState()
  const sessionId: string = await syncRendererSessionState(client, localState)
  const snapshot: SerializedState = await client.getSessionState(sessionId)
  const hydrated: State = hydrateState(snapshot)
  const vaultState: VaultState = await client.getVault()

  if (rootsWereExplicitlySet() || localState.roots.loaded.size > 0) {
    snapshot.roots = await buildSerializedRoots(
      hydrated.graph,
      vaultState,
      localState.roots.loaded,
    )
  }

  if (localState.layout.fit !== undefined) {
    snapshot.layout.fit = localState.layout.fit
  }
  snapshot.meta.revision = localState.meta.revision

  return snapshot
}

export async function syncRendererSessionStateWithDaemon(): Promise<string> {
  const { client }: CurrentDaemonConnection = await getDaemonClientForCurrentVault()
  const localState: State = await getCurrentLiveState()
  return await syncRendererSessionState(client, localState)
}

export async function collapseFolderThroughDaemon(folderId: string): Promise<unknown> {
  const { client }: CurrentDaemonConnection = await getDaemonClientForCurrentVault()
  const sessionId: string = await ensureRendererSession(client)
  return await client.collapse(sessionId, folderId)
}

export async function expandFolderThroughDaemon(folderId: string): Promise<unknown> {
  const { client }: CurrentDaemonConnection = await getDaemonClientForCurrentVault()
  const sessionId: string = await ensureRendererSession(client)
  return await client.expand(sessionId, folderId)
}

export async function getActiveDaemonVaultState(): Promise<VaultState | null> {
  const activeConnection: CachedDaemonConnection | null = getActiveDaemonConnection()
  if (!activeConnection) {
    return null
  }

  try {
    return await activeConnection.client.getVault()
  } catch {
    return null
  }
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

export async function bootstrapDaemonVaultFromLocalState(vault?: string): Promise<void> {
  const connection: CurrentDaemonConnection = vault
    ? await ensureDaemonClientForVault(vault, { timeoutMs: MAIN_DAEMON_TIMEOUT_MS })
    : await getDaemonClientForCurrentVault()

  const desiredVaultState: DesiredVaultState = await getDesiredVaultStateForBootstrap(connection.vault)

  await connection.client.setWritePath(desiredVaultState.writePath)

  for (const readPath of desiredVaultState.readPaths) {
    await connection.client.addReadPath(readPath)
  }
}

export async function refreshMainGraphFromDaemon(vault?: string): Promise<void> {
  const connection: CurrentDaemonConnection = vault
    ? await ensureDaemonClientForVault(vault, { timeoutMs: MAIN_DAEMON_TIMEOUT_MS })
    : await getDaemonClientForCurrentVault()

  await syncMainGraphFromDaemonClient(connection.client)
}

export function __resetDaemonIpcProxyStateForTests(): void {
  cachedVault = null
  rendererSessionId = null
  sessionSyncCache = null
  unsubscribeFromDaemonSSE()
}
