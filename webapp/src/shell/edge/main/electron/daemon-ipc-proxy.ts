import { isDeepStrictEqual } from 'node:util'

import * as O from 'fp-ts/lib/Option.js'

import {
  applyGraphDeltaToGraph,
  buildFolderTree,
  createEmptyGraph,
  getDirectoryTree,
  getExternalReadPaths,
  getReadPaths,
  getProjectRootWatchedDirectory,
  getWritePath,
  mapNewGraphToDelta,
  toAbsolutePath,
  type FolderTreeNode,
  type Graph,
  type GraphDelta,
  type GraphNode,
  type NodeIdAndFilePath,
} from '@vt/graph-model'
import type { VaultState } from '@vt/graph-db-client'
import { hydrateState, type SerializedState, type State } from '@vt/graph-state'

import { broadcastGraphDeltaToUI } from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI'
import { getStarredFolders } from '@/shell/edge/main/graph/watch_folder/starred-folders'
import { getGraph as getLocalGraph, setGraph as setLocalGraph } from '@/shell/edge/main/state/graph-store'
import { getCurrentLiveState, rootsWereExplicitlySet } from '@/shell/edge/main/state/live-state-store'
import { uiAPI } from '@/shell/edge/main/ui-api-proxy'

import {
  ensureDaemonClientForVault,
  getActiveDaemonConnection,
} from './graph-daemon'

type DaemonClient = Awaited<
  ReturnType<typeof ensureDaemonClientForVault>
>['client']

const MAIN_DAEMON_TIMEOUT_MS = 15_000

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
  const activeConnection = getActiveDaemonConnection()
  if (activeConnection) {
    return activeConnection.vault
  }

  const writePath = await getWritePath()
  if (O.isSome(writePath)) {
    return writePath.value
  }

  const vault = getProjectRootWatchedDirectory()
  if (!vault) {
    throw new Error('Watched directory not initialized')
  }
  return vault
}

async function getDesiredVaultStateForBootstrap(vault: string): Promise<{
  readPaths: string[]
  writePath: string
}> {
  const readPaths = [...(await getReadPaths())]
  const writePath = await getWritePath()

  return {
    readPaths,
    writePath: O.isSome(writePath) ? writePath.value : vault,
  }
}

function resetCachesForVault(vault: string): void {
  if (cachedVault === vault) {
    return
  }

  cachedVault = vault
  rendererSessionId = null
  sessionSyncCache = null
}

async function getDaemonClientForCurrentVault(): Promise<{
  client: DaemonClient
  vault: string
}> {
  const vault = await getCurrentVaultOrThrow()
  resetCachesForVault(vault)

  const connection = await ensureDaemonClientForVault(vault, {
    timeoutMs: MAIN_DAEMON_TIMEOUT_MS,
  })
  return { client: connection.client, vault }
}

function normalizeGraphNodes(
  nodes: Record<string, unknown>,
): Record<NodeIdAndFilePath, GraphNode> {
  return Object.fromEntries(
    Object.entries(nodes).map(([nodeId, rawNode]) => {
      const node = rawNode as GraphNode & {
        nodeUIMetadata?: GraphNode['nodeUIMetadata'] & {
          additionalYAMLProps?: unknown
        }
      }

      const additionalYAMLProps = node.nodeUIMetadata?.additionalYAMLProps
      const revivedAdditionalYAMLProps =
        additionalYAMLProps instanceof Map
          ? additionalYAMLProps
          : new Map(
              Object.entries(
                typeof additionalYAMLProps === 'object' &&
                  additionalYAMLProps !== null
                  ? (additionalYAMLProps as Record<string, string>)
                  : {},
              ),
            )

      return [
        nodeId,
        {
          ...node,
          nodeUIMetadata: {
            ...node.nodeUIMetadata,
            additionalYAMLProps: revivedAdditionalYAMLProps,
          },
        },
      ]
    }),
  ) as Record<NodeIdAndFilePath, GraphNode>
}

function normalizeDaemonGraph(raw: { nodes: Record<string, unknown> }): Graph {
  const emptyGraph = createEmptyGraph()
  return applyGraphDeltaToGraph(
    emptyGraph,
    mapNewGraphToDelta({
      ...emptyGraph,
      nodes: normalizeGraphNodes(raw.nodes),
    }),
  )
}

async function getNormalizedDaemonGraph(client: DaemonClient): Promise<Graph> {
  const rawGraph = await client.getGraph()
  const graph = normalizeDaemonGraph({
    nodes:
      typeof rawGraph === 'object' && rawGraph !== null && 'nodes' in rawGraph
        ? (rawGraph.nodes as Record<string, unknown>)
        : {},
  })
  return graph
}

function buildGraphDiff(previous: Graph, next: Graph): GraphDelta {
  const delta: GraphDelta[number][] = []

  for (const [nodeId, previousNode] of Object.entries(previous.nodes) as Array<
    [NodeIdAndFilePath, GraphNode]
  >) {
    if (!next.nodes[nodeId]) {
      delta.push({
        type: 'DeleteNode',
        nodeId,
        deletedNode: O.some(previousNode),
      })
    }
  }

  for (const [nodeId, nextNode] of Object.entries(next.nodes) as Array<
    [NodeIdAndFilePath, GraphNode]
  >) {
    const previousNode = previous.nodes[nodeId]
    if (previousNode && isDeepStrictEqual(previousNode, nextNode)) {
      continue
    }

    delta.push({
      type: 'UpsertNode',
      nodeToUpsert: nextNode,
      previousNode: previousNode ? O.some(previousNode) : O.none,
    })
  }

  return delta
}

async function buildFolderTreeSyncPayload(
  vaultState: VaultState,
  graph: Graph,
): Promise<{
  externalTrees: Record<string, FolderTreeNode>
  rootTree: FolderTreeNode | null
  starredFolders: readonly string[]
  starredTrees: Record<string, FolderTreeNode>
}> {
  const loadedPaths = new Set<string>([
    ...vaultState.readPaths,
    vaultState.writePath,
  ])
  const writePath = toAbsolutePath(vaultState.writePath)
  const graphFilePaths = new Set<string>(Object.keys(graph.nodes))

  let rootTree: FolderTreeNode | null = null
  try {
    const rootEntry = await getDirectoryTree(vaultState.vaultPath)
    rootTree = buildFolderTree(rootEntry, loadedPaths, writePath, graphFilePaths)
  } catch {
    rootTree = null
  }

  const starredFolders = await getStarredFolders()

  const starredTrees: Record<string, FolderTreeNode> = {}
  for (const folder of starredFolders) {
    try {
      const entry = await getDirectoryTree(folder, 3)
      starredTrees[folder] = buildFolderTree(
        entry,
        loadedPaths,
        writePath,
        graphFilePaths,
      )
    } catch {
      // Ignore unreadable starred folders; this matches the existing push path.
    }
  }

  const externalTrees: Record<string, FolderTreeNode> = {}
  for (const folder of getExternalReadPaths(vaultState.readPaths, vaultState.vaultPath)) {
    try {
      const entry = await getDirectoryTree(folder, 3)
      externalTrees[folder] = buildFolderTree(
        entry,
        loadedPaths,
        writePath,
        graphFilePaths,
      )
    } catch {
      // Ignore unreadable external trees; this matches the existing push path.
    }
  }

  return { externalTrees, rootTree, starredFolders, starredTrees }
}

async function syncRendererFromDaemon(
  previousGraph: Graph,
  nextGraph: Graph,
  vaultState: VaultState,
): Promise<void> {
  const delta = buildGraphDiff(previousGraph, nextGraph)
  if (delta.length > 0) {
    broadcastGraphDeltaToUI(delta)
  }

  const treePayload = await buildFolderTreeSyncPayload(vaultState, nextGraph)
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
  const previousGraph = getLocalGraph()
  const nextGraph = await getNormalizedDaemonGraph(client)
  const vaultState = await client.getVault()

  setLocalGraph(nextGraph)
  await syncRendererFromDaemon(previousGraph, nextGraph, vaultState)
}

async function ensureRendererSession(client: DaemonClient): Promise<string> {
  if (rendererSessionId) {
    try {
      await client.getSession(rendererSessionId)
      return rendererSessionId
    } catch {
      rendererSessionId = null
      sessionSyncCache = null
    }
  }

  const created = await client.createSession()
  rendererSessionId = created.sessionId
  sessionSyncCache = {
    sessionId: created.sessionId,
    collapseSet: new Set(),
    selection: new Set(),
    pan: undefined,
    zoom: undefined,
  }
  return created.sessionId
}

async function syncRendererSessionState(
  client: DaemonClient,
  localState: State,
): Promise<string> {
  const sessionId = await ensureRendererSession(client)
  const previous = sessionSyncCache?.sessionId === sessionId
    ? sessionSyncCache
    : {
        sessionId,
        collapseSet: new Set<string>(),
        selection: new Set<string>(),
        pan: undefined,
        zoom: undefined,
      }

  for (const folderId of localState.collapseSet) {
    if (!previous.collapseSet.has(folderId)) {
      await client.collapse(sessionId, folderId)
    }
  }

  for (const folderId of previous.collapseSet) {
    if (!localState.collapseSet.has(folderId)) {
      await client.expand(sessionId, folderId)
    }
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
  const loaded = sortStrings([...loadedRoots])

  try {
    const rootEntry = await getDirectoryTree(vaultState.vaultPath)
    const rootTree = buildFolderTree(
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

async function runVaultMutation(
  mutate: (client: DaemonClient) => Promise<VaultState>,
): Promise<VaultState> {
  const { client } = await getDaemonClientForCurrentVault()
  const previousGraph = getLocalGraph()
  const vaultState = await mutate(client)
  const nextGraph = await getNormalizedDaemonGraph(client)

  setLocalGraph(nextGraph)
  await syncRendererFromDaemon(previousGraph, nextGraph, vaultState)
  return vaultState
}

export async function getGraphFromDaemon(): Promise<Graph> {
  const { client } = await getDaemonClientForCurrentVault()
  return await getNormalizedDaemonGraph(client)
}

export async function getNodeFromDaemon(
  nodeId: string,
): Promise<GraphNode | undefined> {
  const graph = await getGraphFromDaemon()
  return graph.nodes[nodeId]
}

export async function getLiveStateSnapshotFromDaemon(): Promise<SerializedState> {
  const { client } = await getDaemonClientForCurrentVault()
  const localState = await getCurrentLiveState()
  const sessionId = await syncRendererSessionState(client, localState)
  const snapshot = await client.getSessionState(sessionId)
  const hydrated = hydrateState(snapshot)
  const vaultState = await client.getVault()

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

export async function addReadPathThroughDaemon(path: string): Promise<VaultState> {
  return await runVaultMutation((client) => client.addReadPath(path))
}

export async function removeReadPathThroughDaemon(path: string): Promise<VaultState> {
  return await runVaultMutation((client) => client.removeReadPath(path))
}

export async function setWritePathThroughDaemon(path: string): Promise<VaultState> {
  return await runVaultMutation((client) => client.setWritePath(path))
}

export async function bootstrapDaemonVaultFromLocalState(vault?: string): Promise<void> {
  const connection = vault
    ? await ensureDaemonClientForVault(vault, { timeoutMs: MAIN_DAEMON_TIMEOUT_MS })
    : await getDaemonClientForCurrentVault()

  const desiredVaultState = await getDesiredVaultStateForBootstrap(connection.vault)

  await connection.client.setWritePath(desiredVaultState.writePath)

  for (const readPath of desiredVaultState.readPaths) {
    await connection.client.addReadPath(readPath)
  }
}

export async function refreshMainGraphFromDaemon(vault?: string): Promise<void> {
  const connection = vault
    ? await ensureDaemonClientForVault(vault, { timeoutMs: MAIN_DAEMON_TIMEOUT_MS })
    : await getDaemonClientForCurrentVault()

  await syncMainGraphFromDaemonClient(connection.client)
}

export function __resetDaemonIpcProxyStateForTests(): void {
  cachedVault = null
  rendererSessionId = null
  sessionSyncCache = null
}
