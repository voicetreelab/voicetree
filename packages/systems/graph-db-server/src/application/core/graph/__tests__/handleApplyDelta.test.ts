import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, test } from 'vitest'
import type { GraphNode } from '@vt/graph-model/graph'
import {
  buildDeleteNodeDelta,
  normalizeAdditionalYAMLProps,
  normalizeDelta,
  normalizeGraphNode,
  parseApplyDeltaRequest,
  parseGraphDeltaRequest,
} from '../handleApplyDelta.ts'

const NODE_ID = '/tmp/project/node.md'

function graphNodeFixture(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: NODE_ID,
    contentWithoutYamlOrLinks: '# Node\n\nBody',
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
    },
    ...overrides,
  }
}

describe('handleApplyDelta', () => {
  test.each([
    {
      value: { agent_name: 'Ari' },
      expected: { agent_name: 'Ari' },
    },
    {
      value: { flag: true, name: 'Jun' },
      expected: { flag: 'true', name: 'Jun' },
    },
    {
      value: 7,
      expected: {},
    },
  ])('normalizes additional YAML props %#', ({ value, expected }) => {
    expect(normalizeAdditionalYAMLProps(value)).toEqual(expected)
  })

  test('normalizes additional YAML props inside a graph node', () => {
    const node = normalizeGraphNode(graphNodeFixture({
      nodeUIMetadata: {
        color: O.none,
        position: O.none,
        additionalYAMLProps: { agent_name: 'Jun' },
      },
    }))

    expect(node.nodeUIMetadata.additionalYAMLProps).toEqual({ agent_name: 'Jun' })
  })

  test('normalizes upsert deltas and preserves delete deltas', () => {
    const previousNode = graphNodeFixture({
      absoluteFilePathIsID: '/tmp/project/previous.md',
      nodeUIMetadata: {
        color: O.none,
        position: O.none,
        additionalYAMLProps: { previous: '1' },
      },
    })

    const delta = normalizeDelta([
      {
        type: 'UpsertNode',
        nodeToUpsert: graphNodeFixture({
          nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: { next: 'yes' },
          },
        }),
        previousNode: O.some(previousNode),
      },
      {
        type: 'UpsertNode',
        nodeToUpsert: graphNodeFixture({ absoluteFilePathIsID: '/tmp/project/new.md' }),
        previousNode: O.none,
      },
      {
        type: 'DeleteNode',
        nodeId: NODE_ID,
        deletedNode: O.some(previousNode),
      },
    ])

    expect(delta[0].type).toBe('UpsertNode')
    if (delta[0].type === 'UpsertNode') {
      expect(delta[0].nodeToUpsert.nodeUIMetadata.additionalYAMLProps).toEqual({ next: 'yes' })
      expect(O.isSome(delta[0].previousNode)).toBe(true)
      if (O.isSome(delta[0].previousNode)) {
        expect(delta[0].previousNode.value.nodeUIMetadata.additionalYAMLProps).toEqual({ previous: '1' })
      }
    }
    expect(delta[1].type).toBe('UpsertNode')
    if (delta[1].type === 'UpsertNode') {
      expect(delta[1].previousNode).toEqual(O.none)
    }
    expect(delta[2]).toEqual({
      type: 'DeleteNode',
      nodeId: NODE_ID,
      deletedNode: O.some(previousNode),
    })
  })

  test('parses graph delta requests and reports invalid requests', () => {
    const parsed = parseGraphDeltaRequest([
      {
        type: 'UpsertNode',
        nodeToUpsert: graphNodeFixture(),
        previousNode: O.none,
      },
    ])

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.delta).toHaveLength(1)
    expect(parseGraphDeltaRequest({ type: 'UpsertNode' })).toEqual({
      ok: false,
      error: 'Invalid GraphDelta request body',
      code: 'INVALID_GRAPH_DELTA',
    })
  })

  test('parses apply-delta wrapper requests', () => {
    const parsed = parseApplyDeltaRequest({
      delta: [
        {
          type: 'UpsertNode',
          nodeToUpsert: graphNodeFixture(),
          previousNode: O.none,
        },
      ],
      recordForUndo: false,
    })

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.recordForUndo).toBe(false)
      expect(parsed.delta).toHaveLength(1)
    }
    expect(parseApplyDeltaRequest({ delta: 'bad' })).toEqual({
      ok: false,
      error: 'Invalid apply-delta request body',
      code: 'INVALID_APPLY_DELTA',
    })
  })

  test('builds delete-node deltas', () => {
    const node = graphNodeFixture()
    const delta = buildDeleteNodeDelta(NODE_ID, node)

    expect(delta).toEqual([
      {
        type: 'DeleteNode',
        nodeId: NODE_ID,
        deletedNode: O.some(node),
      },
    ])
  })
})
