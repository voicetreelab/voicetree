import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'

import type { FolderTreeNode, Graph, GraphNode } from '@vt/graph-model'
import { GraphDbClientError } from '@vt/graph-db-client'
import type { SerializedState, State } from '@vt/graph-state'

const mockBuildFolderTree = vi.fn()
const mockBroadcastGraphDeltaToUI = vi.fn()
const mockEnsureDaemonClientForVault = vi.fn()
const mockGetCurrentLiveState = vi.fn()
const mockGetDirectoryTree = vi.fn()
const mockGetExternalReadPaths = vi.fn()
const mockGetLocalGraph = vi.fn()
const mockGetProjectRootWatchedDirectory = vi.fn()
const mockSetLocalGraph = vi.fn()
const mockGetStarredFolders = vi.fn()
const mockGetWritePath = vi.fn()
const mockGetActiveDaemonConnection = vi.fn()
const mockRootsWereExplicitlySet = vi.fn()

const mockUiAPI = {
  syncExternalFolderTrees: vi.fn(),
  syncFolderTree: vi.fn(),
  syncStarredFolderTrees: vi.fn(),
  syncVaultState: vi.fn(),
}

vi.mock('@vt/graph-model', async () => {
  const actual: Record<string, unknown> = await vi.importActual('@vt/graph-model')
  return {
    ...actual,
    buildFolderTree: mockBuildFolderTree,
    getDirectoryTree: mockGetDirectoryTree,
    getExternalReadPaths: mockGetExternalReadPaths,
    getProjectRootWatchedDirectory: mockGetProjectRootWatchedDirectory,
    getWritePath: mockGetWritePath,
  }
})

vi.mock(
  '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI',
  () => ({
    broadcastGraphDeltaToUI: mockBroadcastGraphDeltaToUI,
  }),
)

vi.mock('@/shell/edge/main/graph/watch_folder/starred-folders', () => ({
  getStarredFolders: mockGetStarredFolders,
}))

vi.mock('@/shell/edge/main/state/live-state-store', () => ({
  getCurrentLiveState: mockGetCurrentLiveState,
  rootsWereExplicitlySet: mockRootsWereExplicitlySet,
}))

vi.mock('@/shell/edge/main/state/graph-store', () => ({
  getGraph: mockGetLocalGraph,
  setGraph: mockSetLocalGraph,
}))

vi.mock('@/shell/edge/main/ui-api-proxy', () => ({
  uiAPI: mockUiAPI,
}))

vi.mock('@/shell/edge/main/electron/graph-daemon', () => ({
  ensureDaemonClientForVault: mockEnsureDaemonClientForVault,
  getActiveDaemonConnection: mockGetActiveDaemonConnection,
}))

function makeNode(id: string, content: string): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
      isContextNode: false,
    },
  }
}

function makeSerializedSnapshot(absolutePath: string): SerializedState {
  return {
    graph: {
      nodes: {
        [`${absolutePath}/a.md`]: makeNode(`${absolutePath}/a.md`, 'from daemon'),
      },
      incomingEdgesIndex: [],
      nodeByBaseName: [],
      unresolvedLinksIndex: [],
    },
    roots: {
      loaded: [absolutePath],
      folderTree: [],
    },
    collapseSet: [],
    selection: [],
    layout: {
      positions: [],
    },
    meta: {
      schemaVersion: 1,
      revision: 0,
    },
  }
}

function makeFolderTree(absolutePath: string): FolderTreeNode {
  return {
    name: 'vault',
    absolutePath,
    loadState: 'loaded',
    isWriteTarget: true,
    children: [],
  }
}

describe('daemon IPC proxy', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetProjectRootWatchedDirectory.mockReturnValue('/vault')
    mockGetExternalReadPaths.mockReturnValue([])
    mockGetLocalGraph.mockReturnValue({
      nodes: {},
      incomingEdgesIndex: new Map(),
      nodeByBaseName: new Map(),
      unresolvedLinksIndex: new Map(),
    })
    mockGetStarredFolders.mockResolvedValue([])
    mockGetWritePath.mockResolvedValue(O.none)
    mockGetActiveDaemonConnection.mockReturnValue(null)
    mockGetDirectoryTree.mockResolvedValue({
      absolutePath: '/vault',
      name: 'vault',
      isDirectory: true,
      children: [],
    })
    mockBuildFolderTree.mockReturnValue(makeFolderTree('/vault'))

    const proxy = await import('./daemon-ipc-proxy')
    proxy.__resetDaemonIpcProxyStateForTests()
  })

  it('normalizes daemon graph responses into a Graph-shaped object', async () => {
    const client = {
      getGraph: vi.fn().mockResolvedValue({
        nodes: {
          '/vault/a.md': makeNode('/vault/a.md', 'hello'),
        },
      }),
    }
    mockEnsureDaemonClientForVault.mockResolvedValue({ client })

    const proxy = await import('./daemon-ipc-proxy')
    const graph: Graph = await proxy.getGraphFromDaemon()

    expect(mockEnsureDaemonClientForVault).toHaveBeenCalledWith('/vault', {
      timeoutMs: 15_000,
    })
    expect(graph.nodes['/vault/a.md']).toBeDefined()
    expect(graph.incomingEdgesIndex).toBeInstanceOf(Map)
    expect(graph.nodeByBaseName).toBeInstanceOf(Map)
    expect(graph.unresolvedLinksIndex).toBeInstanceOf(Map)
  })

  it('syncs renderer session state before serving live-state snapshots', async () => {
    const snapshot = makeSerializedSnapshot('/vault')
    const client = {
      createSession: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
      collapse: vi.fn().mockResolvedValue({ collapseSet: ['/vault/docs/'] }),
      expand: vi.fn(),
      getSession: vi.fn(),
      getSessionState: vi.fn().mockResolvedValue(snapshot),
      getVault: vi.fn().mockResolvedValue({
        vaultPath: '/vault',
        readPaths: ['/vault'],
        writePath: '/vault',
      }),
      setSelection: vi.fn().mockResolvedValue({ selection: ['/vault/a.md'] }),
      updateLayout: vi.fn().mockResolvedValue({
        layout: {
          positions: {},
          pan: { x: 10, y: 20 },
          zoom: 2,
        },
      }),
    }
    mockEnsureDaemonClientForVault.mockResolvedValue({ client })

    const localState: State = {
      graph: {
        nodes: {},
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
      },
      roots: {
        loaded: new Set(['/custom-root']),
        folderTree: [],
      },
      collapseSet: new Set(['/vault/docs/']),
      selection: new Set(['/vault/a.md']),
      layout: {
        positions: new Map(),
        pan: { x: 10, y: 20 },
        zoom: 2,
        fit: { paddingPx: 24 },
      },
      meta: {
        schemaVersion: 1,
        revision: 7,
      },
    }
    mockGetCurrentLiveState.mockResolvedValue(localState)
    mockRootsWereExplicitlySet.mockReturnValue(true)

    const proxy = await import('./daemon-ipc-proxy')
    const result = await proxy.getLiveStateSnapshotFromDaemon()

    expect(client.createSession).toHaveBeenCalledTimes(1)
    expect(client.collapse).toHaveBeenCalledWith('session-1', '/vault/docs/')
    expect(client.setSelection).toHaveBeenCalledWith('session-1', {
      mode: 'replace',
      nodeIds: ['/vault/a.md'],
    })
    expect(client.updateLayout).toHaveBeenCalledWith('session-1', {
      pan: { x: 10, y: 20 },
      zoom: 2,
    })
    expect(result.meta.revision).toBe(7)
    expect(result.layout.fit).toEqual({ paddingPx: 24 })
    expect(result.roots.loaded).toEqual(['/custom-root'])
    expect(result.roots.folderTree).toEqual([makeFolderTree('/vault')])
  })

  it('pushes daemon-backed graph and vault refreshes after addReadPath', async () => {
    const previousGraph = {
      nodes: {
        '/vault/a.md': makeNode('/vault/a.md', 'a'),
      },
    }
    const nextGraph = {
      nodes: {
        '/vault/a.md': makeNode('/vault/a.md', 'a'),
        '/vault/docs/b.md': makeNode('/vault/docs/b.md', 'b'),
      },
    }
    const client = {
      addReadPath: vi.fn().mockResolvedValue({
        vaultPath: '/vault',
        readPaths: ['/vault/docs'],
        writePath: '/vault',
      }),
      getGraph: vi
        .fn()
        .mockResolvedValueOnce(previousGraph)
        .mockResolvedValueOnce(nextGraph),
    }
    mockEnsureDaemonClientForVault.mockResolvedValue({ client })

    const proxy = await import('./daemon-ipc-proxy')
    const result = await proxy.addReadPathThroughDaemon('/vault/docs')

    expect(result).toEqual({
      vaultPath: '/vault',
      readPaths: ['/vault/docs'],
      writePath: '/vault',
    })
    expect(client.addReadPath).toHaveBeenCalledWith('/vault/docs')
    expect(mockSetLocalGraph).toHaveBeenCalledTimes(1)
    expect(mockBroadcastGraphDeltaToUI).toHaveBeenCalledTimes(1)
    expect(mockUiAPI.syncVaultState).toHaveBeenCalledWith({
      readPaths: ['/vault/docs'],
      starredFolders: [],
      writePath: '/vault',
    })
    expect(mockUiAPI.syncFolderTree).toHaveBeenCalledWith(makeFolderTree('/vault'))
  })

  it('re-throws daemon errors for proxied write-path mutations', async () => {
    const error = new GraphDbClientError(400, 'PATH_NOT_FOUND', 'missing path')
    const client = {
      getGraph: vi.fn().mockResolvedValue({
        nodes: {
          '/vault/a.md': makeNode('/vault/a.md', 'a'),
        },
      }),
      setWritePath: vi.fn().mockRejectedValue(error),
    }
    mockEnsureDaemonClientForVault.mockResolvedValue({ client })

    const proxy = await import('./daemon-ipc-proxy')

    await expect(proxy.setWritePathThroughDaemon('/vault/out')).rejects.toBe(error)
    expect(mockBroadcastGraphDeltaToUI).not.toHaveBeenCalled()
  })

  it('refreshes the main graph store from the daemon snapshot', async () => {
    const client = {
      getGraph: vi.fn().mockResolvedValue({
        nodes: {
          '/vault/a.md': makeNode('/vault/a.md', 'fresh'),
        },
      }),
      getVault: vi.fn().mockResolvedValue({
        vaultPath: '/vault',
        readPaths: ['/vault'],
        writePath: '/vault',
      }),
    }
    mockEnsureDaemonClientForVault.mockResolvedValue({ client })

    const proxy = await import('./daemon-ipc-proxy')
    await proxy.refreshMainGraphFromDaemon('/vault')

    expect(mockEnsureDaemonClientForVault).toHaveBeenCalledWith('/vault', {
      timeoutMs: 15_000,
    })
    expect(mockSetLocalGraph).toHaveBeenCalledTimes(1)
    expect(mockUiAPI.syncVaultState).toHaveBeenCalledWith({
      readPaths: ['/vault'],
      starredFolders: [],
      writePath: '/vault',
    })
  })
})
