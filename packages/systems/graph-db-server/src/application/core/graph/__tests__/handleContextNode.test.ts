import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, test } from 'vitest'
import { createGraph, type GraphNode } from '@vt/graph-model/graph'
import {
  composeContainedIdsUpdateResponse,
  composeFromQuestionResponse,
  composeNodeIdResponse,
  composeUnseenNodesResponse,
  parseContextNodeContainedIdsRequest,
  parseContextNodeFromQuestionRequest,
  parseContextNodeFromSelectedNodesRequest,
  parseContextNodeRequest,
  parseUnseenNodesAroundContextNodeRequest,
} from '../handleContextNode.ts'

const PARENT_ID = '/tmp/project/parent.md'
const CHILD_ID = '/tmp/project/child.md'

function graphNodeFixture(
  id: string,
  contentWithoutYamlOrLinks: string,
  outgoingEdges: GraphNode['outgoingEdges'] = [],
): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges,
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
    },
  }
}

describe('handleContextNode', () => {
  test('parses context node creation requests', () => {
    expect(parseContextNodeRequest({
      parentNodeId: PARENT_ID,
      semanticNodeIds: [CHILD_ID],
    })).toEqual({
      ok: true,
      parentNodeId: PARENT_ID,
      semanticNodeIds: [CHILD_ID],
    })

    expect(parseContextNodeRequest({ parentNodeId: PARENT_ID })).toEqual({
      ok: false,
      error: 'Invalid request body',
      code: 'INVALID_REQUEST_BODY',
    })
  })

  test('parses question and selected-node requests', () => {
    expect(parseContextNodeFromQuestionRequest({
      nodeIds: [PARENT_ID],
      question: 'What changed?',
      semanticNodeIds: [CHILD_ID],
    })).toEqual({
      ok: true,
      nodeIds: [PARENT_ID],
      question: 'What changed?',
      semanticNodeIds: [CHILD_ID],
    })

    expect(parseContextNodeFromSelectedNodesRequest({
      taskNodeId: PARENT_ID,
      selectedNodeIds: [CHILD_ID],
    })).toEqual({
      ok: true,
      taskNodeId: PARENT_ID,
      selectedNodeIds: [CHILD_ID],
    })

    expect(parseContextNodeFromQuestionRequest({ question: 'missing arrays' })).toEqual({
      ok: false,
      error: 'Invalid request body',
      code: 'INVALID_REQUEST_BODY',
    })
    expect(parseContextNodeFromSelectedNodesRequest({ taskNodeId: PARENT_ID })).toEqual({
      ok: false,
      error: 'Invalid request body',
      code: 'INVALID_REQUEST_BODY',
    })
  })

  test('parses unseen-node and contained-id requests', () => {
    expect(parseUnseenNodesAroundContextNodeRequest({
      contextNodeId: CHILD_ID,
      searchFromNode: PARENT_ID,
    })).toEqual({
      ok: true,
      contextNodeId: CHILD_ID,
      searchFromNode: PARENT_ID,
    })

    expect(parseContextNodeContainedIdsRequest({
      contextNodeId: CHILD_ID,
      newNodeIds: [PARENT_ID],
    })).toEqual({
      ok: true,
      contextNodeId: CHILD_ID,
      newNodeIds: [PARENT_ID],
    })

    expect(parseUnseenNodesAroundContextNodeRequest({ searchFromNode: PARENT_ID })).toEqual({
      ok: false,
      error: 'Invalid request body',
      code: 'INVALID_REQUEST_BODY',
    })
    expect(parseContextNodeContainedIdsRequest({ contextNodeId: CHILD_ID })).toEqual({
      ok: false,
      error: 'Invalid request body',
      code: 'INVALID_REQUEST_BODY',
    })
  })

  test('composes context node response payloads', () => {
    const parent = graphNodeFixture(PARENT_ID, '# Parent', [
      { targetId: CHILD_ID, label: '' },
    ])
    const child = graphNodeFixture(CHILD_ID, '# Child\n\nBody')
    const graph = createGraph({ [PARENT_ID]: parent, [CHILD_ID]: child })

    expect(composeNodeIdResponse(CHILD_ID)).toEqual({ nodeId: CHILD_ID })
    expect(composeFromQuestionResponse(CHILD_ID, graph)).toEqual({
      nodeId: CHILD_ID,
      title: 'Child',
      parentNodePath: PARENT_ID,
    })
    expect(composeFromQuestionResponse('/tmp/project/missing.md', graph)).toEqual({
      nodeId: '/tmp/project/missing.md',
      title: '',
      parentNodePath: '',
    })
    expect(composeContainedIdsUpdateResponse()).toEqual({ updated: true })
  })

  test('composes schema-valid unseen node responses', () => {
    expect(composeUnseenNodesResponse([
      { nodeId: CHILD_ID, content: '# Child' },
    ])).toEqual({
      nodes: [{ nodeId: CHILD_ID, content: '# Child' }],
    })
  })
})
