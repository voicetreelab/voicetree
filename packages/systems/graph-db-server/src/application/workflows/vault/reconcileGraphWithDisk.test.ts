import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as O from 'fp-ts/lib/Option.js'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createEmptyGraph,
  createGraph,
  initGraphModel,
  type Graph,
  type GraphDelta,
  type GraphNode,
} from '@vt/graph-model'
import { getGraph, setGraph } from '../../../state/graph-store.ts'
import { subscribe, type SequencedDeltaEvent } from '../../../state/events/deltaEventBus.ts'
import { clearPendingWrite, markPendingWrite } from '../../../data/watch-folder/pending-writes.ts'
import { reconcileGraphWithDisk } from './reconcileGraphWithDisk.ts'

function makeLeaf(absolutePath: string): GraphNode {
  return {
    kind: 'leaf',
    absoluteFilePathIsID: absolutePath,
    contentWithoutYamlOrLinks: `# ${absolutePath}`,
    outgoingEdges: [],
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
    },
  }
}

function graphFromNodeIds(absolutePaths: readonly string[]): Graph {
  return createGraph(Object.fromEntries(
    absolutePaths.map((p): readonly [string, GraphNode] => [p, makeLeaf(p)]),
  ))
}

describe('reconcileGraphWithDisk', () => {
  let tempRoot: string
  let publishedDeltas: GraphDelta[]
  let editorUpdates: GraphDelta[]
  let unsubscribe: () => void

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'reconcile-disk-'))
    publishedDeltas = []
    editorUpdates = []
    initGraphModel(
      { appSupportPath: tempRoot },
      {
        onFloatingEditorUpdate(delta: GraphDelta): void {
          editorUpdates.push(delta)
        },
      },
    )
    unsubscribe = subscribe((event: SequencedDeltaEvent): void => {
      if (event.source === 'reconcile:disk') publishedDeltas.push(event.delta)
    })
  })

  afterEach(async () => {
    unsubscribe()
    setGraph(createEmptyGraph())
    initGraphModel({ appSupportPath: tempRoot }, {})
    await rm(tempRoot, { recursive: true, force: true })
  })

  test('returns empty delta and broadcasts nothing when every graph node still has its file on disk', async () => {
    const a = join(tempRoot, 'a.md')
    const b = join(tempRoot, 'b.md')
    await writeFile(a, '# a\n', 'utf8')
    await writeFile(b, '# b\n', 'utf8')
    setGraph(graphFromNodeIds([a, b]))

    const delta = await reconcileGraphWithDisk()

    expect(delta).toEqual([])
    expect(publishedDeltas).toEqual([])
    expect(editorUpdates).toEqual([])
    expect(Object.keys(getGraph().nodes).sort()).toEqual([a, b].sort())
  })

  test('does not delete a missing node while a daemon write to its path is still in flight', async () => {
    const inFlight = join(tempRoot, 'inflight.md')
    setGraph(graphFromNodeIds([inFlight]))
    markPendingWrite(inFlight)
    try {
      const delta = await reconcileGraphWithDisk()

      expect(delta).toEqual([])
      expect(publishedDeltas).toEqual([])
      expect(Object.keys(getGraph().nodes)).toEqual([inFlight])
    } finally {
      clearPendingWrite(inFlight)
    }
  })

  test('emits DeleteNode for graph nodes whose files are gone, removes them from in-memory graph, and broadcasts the merged delta', async () => {
    const existing = join(tempRoot, 'existing.md')
    const missing = join(tempRoot, 'missing.md')
    await writeFile(existing, '# existing\n', 'utf8')
    setGraph(graphFromNodeIds([existing, missing]))

    const delta = await reconcileGraphWithDisk()

    expect(delta).toHaveLength(1)
    expect(delta[0]).toMatchObject({ type: 'DeleteNode', nodeId: missing })
    expect(Object.keys(getGraph().nodes)).toEqual([existing])
    expect(publishedDeltas).toEqual([delta])
    expect(editorUpdates).toEqual([delta])
  })
})
