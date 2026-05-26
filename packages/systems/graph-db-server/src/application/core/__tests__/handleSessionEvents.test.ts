import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, test } from 'vitest'
import {
  createGraph,
  type GraphDelta,
  type GraphNode,
} from '@vt/graph-model/graph'
import type { State } from '@vt/graph-state'
import type { ProjectedGraph } from '@vt/graph-state/contract'
import {
  coalesceProjectDeltaEvents,
  decideReplayStrategy,
  formatSSE,
  handleProjectDeltaEvent,
  handleReplayResetSnapshot,
  parseSince,
  stringifyGraphForSSE,
} from '../handleSessionEvents.ts'

const NODE_ID = '/vault/docs/one.md'

function graphNodeFixture(id = NODE_ID): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: '# one\n\nbody',
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
    },
  }
}

function stateFixture(): State {
  return {
    graph: createGraph({ [NODE_ID]: graphNodeFixture() }),
    roots: {
      loaded: new Set<string>(['/vault']),
      folderTree: [],
    },
    collapseSet: new Set<string>(),
    selection: new Set<string>(),
    layout: {
      positions: new Map(),
      pan: { x: 0, y: 0 },
      zoom: 1,
    },
    meta: {
      schemaVersion: 1,
      revision: 7,
      mutatedAt: '1970-01-01T00:00:00.100Z',
    },
  }
}

function projectedGraphFixture(): ProjectedGraph {
  return {
    nodes: [],
    edges: [],
    rootPath: '/vault',
    revision: 7,
    forests: [],
    arboricity: 0,
    recentNodeIds: [],
  }
}

describe('handleSessionEvents', () => {
  test('formats a server-sent event block', () => {
    expect(formatSSE('projectedGraph', '{"ok":true}')).toBe(
      'event: projectedGraph\ndata: {"ok":true}\n\n',
    )
  })

  test('serializes Map values as JSON objects for SSE payloads', () => {
    const graph = {
      ...projectedGraphFixture(),
      debugMap: new Map<string, number>([['a', 1]]),
    } as unknown as ProjectedGraph

    expect(stringifyGraphForSSE(graph)).toContain('"debugMap":{"a":1}')
  })

  test.each([
    { rawSince: undefined, currentSeq: 9, expected: 9 },
    { rawSince: 'not-a-number', currentSeq: 9, expected: 9 },
    { rawSince: '0', currentSeq: 9, expected: 0 },
    { rawSince: '-5', currentSeq: 9, expected: 0 },
    { rawSince: '42', currentSeq: 9, expected: 42 },
  ])('parses since=$rawSince as $expected', ({ rawSince, currentSeq, expected }) => {
    expect(parseSince(rawSince, currentSeq)).toBe(expected)
  })

  test.each([
    {
      input: { requestedSince: 5, oldestSeq: 2, isReplayAvailable: true },
      expected: { kind: 'replay' },
    },
    {
      input: { requestedSince: 5, oldestSeq: 8, isReplayAvailable: false },
      expected: { kind: 'reset', requestedSince: 5, oldestSeq: 8 },
    },
    {
      input: { requestedSince: 5, oldestSeq: null, isReplayAvailable: false },
      expected: { kind: 'replay' },
    },
  ])('decides replay strategy %#', ({ input, expected }) => {
    expect(decideReplayStrategy(input)).toEqual(expected)
  })

  test('projects a delta event with recent node ids and sequence', () => {
    const delta: GraphDelta = [
      {
        type: 'UpsertNode',
        nodeToUpsert: graphNodeFixture(),
        previousNode: O.none,
      },
    ]

    const result = handleProjectDeltaEvent(stateFixture(), { delta, seq: 12 })

    expect(result.graph.recentNodeIds).toEqual([NODE_ID])
    expect(result.graph.seq).toBe(12)
    expect(result.graph.revision).toBe(7)
  })

  test('projects delta event suppression metadata for subscribers', () => {
    const delta: GraphDelta = [
      {
        type: 'UpsertNode',
        nodeToUpsert: graphNodeFixture(),
        previousNode: O.none,
      },
    ]

    const result = handleProjectDeltaEvent(stateFixture(), {
      delta,
      seq: 12,
      suppressForSubscribers: ['editor-1'],
    })

    expect(result.graph.suppressForSubscribers).toEqual(['editor-1'])
  })

  test('coalesces delta events with latest sequence and combined subscriber suppression', () => {
    const firstNode = graphNodeFixture('/vault/docs/first.md')
    const secondNode = graphNodeFixture('/vault/docs/second.md')
    const result = coalesceProjectDeltaEvents([
      {
        delta: [{ type: 'UpsertNode', nodeToUpsert: firstNode, previousNode: O.none }],
        seq: 10,
        suppressForSubscribers: ['editor-1'],
      },
      {
        delta: [{ type: 'UpsertNode', nodeToUpsert: secondNode, previousNode: O.none }],
        seq: 11,
        suppressForSubscribers: ['editor-1', 'editor-2'],
      },
    ])

    expect(result).toEqual({
      delta: [
        { type: 'UpsertNode', nodeToUpsert: firstNode, previousNode: O.none },
        { type: 'UpsertNode', nodeToUpsert: secondNode, previousNode: O.none },
      ],
      seq: 11,
      suppressForSubscribers: ['editor-1', 'editor-2'],
    })
  })

  test('projects a replay reset snapshot with metadata', () => {
    const result = handleReplayResetSnapshot(stateFixture(), 3, 9, 18)

    expect(result.graph.recentNodeIds).toEqual([])
    expect(result.graph.seq).toBe(18)
    expect(result.graph.replayReset).toEqual({
      reason: 'buffer_evicted',
      requestedSince: 3,
      oldestSeq: 9,
      currentSeq: 18,
    })
  })
})
