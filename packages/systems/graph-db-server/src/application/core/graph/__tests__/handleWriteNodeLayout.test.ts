import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, test } from 'vitest'
import { createGraph, type GraphNode } from '@vt/graph-model/graph'
import {
  graphWithUpdatedNodeLayout,
  folderSizesFromRecords,
  parseWriteNodeLayoutRequest,
} from '../handleWriteNodeLayout.ts'

const NODE_A = '/tmp/project/a.md'
const NODE_B = '/tmp/project/b.md'
const FOLDER = '/tmp/project/work/'

function graphNodeFixture(id: string): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: `# ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      size: O.none,
      additionalYAMLProps: {},
    },
  }
}

describe('handleWriteNodeLayout', () => {
  test('parses well-formed layout requests (position, size, both)', () => {
    expect(parseWriteNodeLayoutRequest({
      layout: {
        [NODE_A]: { x: 10, y: 20 },
        [NODE_B]: { w: 300, h: 200 },
      },
    })).toEqual({
      ok: true,
      layout: {
        [NODE_A]: { x: 10, y: 20 },
        [NODE_B]: { w: 300, h: 200 },
      },
    })
  })

  test('rejects a non-numeric field', () => {
    expect(parseWriteNodeLayoutRequest({ layout: { [NODE_A]: { x: 'nope' } } })).toEqual({
      ok: false,
      error: 'Invalid request body',
      code: 'INVALID_REQUEST_BODY',
    })
  })

  test('applies position to a node, leaving others untouched', () => {
    const graph = createGraph({
      [NODE_A]: graphNodeFixture(NODE_A),
      [NODE_B]: graphNodeFixture(NODE_B),
    })

    const result = graphWithUpdatedNodeLayout(graph, {
      [NODE_A]: { x: 10, y: 20 },
      '/tmp/project/missing.md': { x: 99, y: 100 },
    })

    expect(result.written).toBe(1)
    expect(result.graph.nodes[NODE_A].nodeUIMetadata.position).toEqual(O.some({ x: 10, y: 20 }))
    expect(result.graph.nodes[NODE_B]).toBe(graph.nodes[NODE_B])
  })

  test('applies a size-only record without disturbing position', () => {
    const seeded = graphNodeFixture(NODE_A)
    const graph = createGraph({
      [NODE_A]: { ...seeded, nodeUIMetadata: { ...seeded.nodeUIMetadata, position: O.some({ x: 5, y: 6 }) } },
    })

    const result = graphWithUpdatedNodeLayout(graph, { [NODE_A]: { w: 320, h: 240 } })

    expect(result.written).toBe(1)
    expect(result.graph.nodes[NODE_A].nodeUIMetadata.size).toEqual(O.some({ width: 320, height: 240 }))
    expect(result.graph.nodes[NODE_A].nodeUIMetadata.position).toEqual(O.some({ x: 5, y: 6 }))
  })

  test('ignores a record with no complete position and no complete size', () => {
    const graph = createGraph({ [NODE_A]: graphNodeFixture(NODE_A) })
    // x without y, w without h → nothing actionable.
    const result = graphWithUpdatedNodeLayout(graph, { [NODE_A]: { x: 1, w: 9 } })
    expect(result.written).toBe(0)
    expect(result.graph.nodes[NODE_A]).toBe(graph.nodes[NODE_A])
  })

  test('does not fold a folder-keyed record into the graph', () => {
    const graph = createGraph({ [NODE_A]: graphNodeFixture(NODE_A) })
    // A folder id (trailing slash) has no graph node — it must be ignored here
    // (it is routed to the folder-layout store instead).
    const result = graphWithUpdatedNodeLayout(graph, { [FOLDER]: { w: 300, h: 240 } })
    expect(result.written).toBe(0)
    expect(result.graph.nodes[NODE_A]).toBe(graph.nodes[NODE_A])
  })
})

describe('folderSizesFromRecords', () => {
  test('extracts folder-keyed size records and ignores node records', () => {
    const folders = folderSizesFromRecords({
      [FOLDER]: { w: 300, h: 240 },
      '/tmp/project/nested/': { w: 120, h: 80 },
      [NODE_A]: { x: 10, y: 20 },        // node position — not a folder
      [NODE_B]: { w: 50, h: 50 },        // node size record — not a folder id
    })
    expect(folders.get(FOLDER)).toEqual({ width: 300, height: 240 })
    expect(folders.get('/tmp/project/nested/')).toEqual({ width: 120, height: 80 })
    expect(folders.has(NODE_A)).toBe(false)
    expect(folders.has(NODE_B)).toBe(false)
  })

  test('ignores a folder record lacking a complete size', () => {
    const folders = folderSizesFromRecords({ [FOLDER]: { w: 300 } })
    expect(folders.size).toBe(0)
  })
})
