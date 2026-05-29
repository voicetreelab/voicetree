import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, test } from 'vitest'
import { createGraph, type GraphNode } from '@vt/graph-model/graph'
import {
  graphWithUpdatedPositions,
  parseWritePositionsRequest,
} from '../handleWritePositions.ts'

const NODE_A = '/tmp/vault/a.md'
const NODE_B = '/tmp/vault/b.md'

function graphNodeFixture(id: string): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: `# ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
    },
  }
}

describe('handleWritePositions', () => {
  test('parses write position requests', () => {
    expect(parseWritePositionsRequest({
      positions: {
        [NODE_A]: { x: 10, y: 20 },
      },
    })).toEqual({
      ok: true,
      positions: {
        [NODE_A]: { x: 10, y: 20 },
      },
    })

    expect(parseWritePositionsRequest({ positions: { [NODE_A]: { x: 1 } } })).toEqual({
      ok: false,
      error: 'Invalid request body',
      code: 'INVALID_REQUEST_BODY',
    })
  })

  test('updates only nodes with supplied positions', () => {
    const graph = createGraph({
      [NODE_A]: graphNodeFixture(NODE_A),
      [NODE_B]: graphNodeFixture(NODE_B),
    })

    const result = graphWithUpdatedPositions(graph, {
      [NODE_A]: { x: 10, y: 20 },
      '/tmp/vault/missing.md': { x: 99, y: 100 },
    })

    expect(result.written).toBe(1)
    expect(result.graph.nodes[NODE_A].nodeUIMetadata.position).toEqual(
      O.some({ x: 10, y: 20 }),
    )
    expect(result.graph.nodes[NODE_B]).toBe(graph.nodes[NODE_B])
  })
})
