import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as O from 'fp-ts/lib/Option.js'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  applyGraphDeltaToGraph,
  createGraph,
  type Graph,
  type GraphDelta,
  type GraphNode,
} from '@vt/graph-model/graph'
import {
  buildMissingFileDeleteDelta,
  graphNodePathExists,
  reconcileGraphWithDisk,
  type GraphDiskReconciliationDependencies,
} from './graphDiskReconciliation.ts'

function makeNode(id: string): GraphNode {
  return {
    kind: 'leaf',
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: `# ${id}`,
    outgoingEdges: [],
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
    },
  }
}

function graphFromNodeIds(nodeIds: readonly string[]): Graph {
  return createGraph(Object.fromEntries(
    nodeIds.map((nodeId: string): readonly [string, GraphNode] => [
      nodeId,
      makeNode(nodeId),
    ]),
  ))
}

describe('graph disk reconciliation', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'graph-disk-reconcile-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('builds DeleteNode deltas for graph nodes whose files are gone', async () => {
    const existing = join(root, 'existing.md')
    const missing = join(root, 'missing.md')
    await writeFile(existing, '# Existing\n', 'utf8')

    const delta = await buildMissingFileDeleteDelta(
      graphFromNodeIds([existing, missing]),
      { graphNodePathExists, isPendingWrite: () => false },
    )

    expect(delta).toHaveLength(1)
    expect(delta[0]).toMatchObject({ type: 'DeleteNode', nodeId: missing })
    expect(delta[0]?.type === 'DeleteNode' && O.isSome(delta[0].deletedNode)).toBe(true)
  })

  test('does not delete missing nodes that still have daemon writes in flight', async () => {
    const pending = join(root, 'pending.md')

    const delta = await buildMissingFileDeleteDelta(
      graphFromNodeIds([pending]),
      {
        graphNodePathExists,
        isPendingWrite: (nodeId: string): boolean => nodeId === pending,
      },
    )

    expect(delta).toEqual([])
  })

  test('applies and publishes only the observable missing-file delta', async () => {
    const existing = join(root, 'existing.md')
    const missing = join(root, 'missing.md')
    await writeFile(existing, '# Existing\n', 'utf8')

    let graph = graphFromNodeIds([existing, missing])
    const published: GraphDelta[] = []
    const editorUpdates: GraphDelta[] = []

    const dependencies: GraphDiskReconciliationDependencies = {
      readGraph: () => graph,
      graphNodePathExists,
      isPendingWrite: () => false,
      async applyGraphDeltaToMemState(delta: GraphDelta): Promise<GraphDelta> {
        graph = applyGraphDeltaToGraph(graph, delta)
        return delta
      },
      publishDelta(delta: GraphDelta): void {
        published.push(delta)
      },
      refreshGraphChangeSideEffects(): void {},
      updateFloatingEditors(delta: GraphDelta): void {
        editorUpdates.push(delta)
      },
    }

    const delta = await reconcileGraphWithDisk(dependencies)

    expect(delta.map(d => d.type === 'DeleteNode' ? d.nodeId : '')).toEqual([missing])
    expect(Object.keys(graph.nodes).sort()).toEqual([existing])
    expect(published).toEqual([delta])
    expect(editorUpdates).toEqual([delta])
  })
})
