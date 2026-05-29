import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, NodeIdAndFilePath } from '@vt/graph-model/graph'
import { buildIncomingEdgesIndex } from '@vt/graph-model/graph'

vi.mock('@/shell/edge/main/graph/watch_folder/watchFolder', () => ({
  getWriteFolderPath: vi.fn()
}))

const mocks = vi.hoisted(() => ({
  spawnTerminalWithContextNode: vi.fn()
}))

vi.mock('@vt/vt-daemon-client', () => ({
  spawnTerminalWithContextNode: mocks.spawnTerminalWithContextNode
}))

vi.mock('@/shell/edge/main/runtime/electron/daemon/daemon-url-binding', () => ({
  getVtDaemonClient: vi.fn().mockReturnValue({} as unknown),
}))

vi.mock('@/shell/edge/main/runtime/electron/daemon/ipc/daemon-ipc-proxy', () => ({
  getGraphFromDaemon: vi.fn(),
  postDeltaThroughDaemonWithEditors: vi.fn().mockResolvedValue(undefined)
}))

import { runAgentOnSelectedNodes, type RunAgentOnSelectedResult } from './runAgentOnSelectedNodes'
import { getWriteFolderPath } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { getGraphFromDaemon, postDeltaThroughDaemonWithEditors } from '@/shell/edge/main/runtime/electron/daemon/ipc/daemon-ipc-proxy'

function createNode(id: NodeIdAndFilePath, content: string): GraphNode {
  return {
    kind: 'leaf',
    absoluteFilePathIsID: id,
    outgoingEdges: [],
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
      isContextNode: false
    }
  }
}

function createGraph(nodes: Record<NodeIdAndFilePath, GraphNode>): Graph {
  return {
    nodes,
    incomingEdgesIndex: buildIncomingEdgesIndex(nodes),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map()
  }
}

describe('runAgentOnSelectedNodes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes selected nodes to spawnTerminalWithContextNode, not as spawnDirectory', async () => {
    const selectedNodeIds: readonly NodeIdAndFilePath[] = [
      '/vault/a.md' as NodeIdAndFilePath,
      '/vault/b.md' as NodeIdAndFilePath
    ]
    const graph: Graph = createGraph({
      [selectedNodeIds[0]]: createNode(selectedNodeIds[0], '# A'),
      [selectedNodeIds[1]]: createNode(selectedNodeIds[1], '# B')
    })

    vi.mocked(getGraphFromDaemon).mockResolvedValue(graph)
    vi.mocked(getWriteFolderPath).mockResolvedValue(O.some('/vault'))
    vi.mocked(mocks.spawnTerminalWithContextNode).mockResolvedValue({
      terminalId: 'agent-1',
      contextNodeId: '/vault/ctx-nodes/task_context.md' as NodeIdAndFilePath
    })

    const result: RunAgentOnSelectedResult = await runAgentOnSelectedNodes({
      selectedNodeIds,
      taskDescription: 'Check these nodes',
      position: { x: 10, y: 20 }
    })

    expect(result.terminalId).toBe('agent-1')
    expect(result.contextNodeId).toBe('/vault/ctx-nodes/task_context.md')
    expect(result.taskNodeId).toMatch(/\.md$/)
    expect(postDeltaThroughDaemonWithEditors).toHaveBeenCalledTimes(1)

    const [, request] = mocks.spawnTerminalWithContextNode.mock.calls[0]
    expect(request).toEqual({
      taskNodeId: result.taskNodeId,
      skipFitAnimation: false,
      startUnpinned: false,
      selectedNodeIds,
    })
  })
})
