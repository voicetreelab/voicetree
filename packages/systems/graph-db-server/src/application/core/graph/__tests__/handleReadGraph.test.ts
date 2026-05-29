import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, test } from 'vitest'
import { createGraph, type GraphNode } from '@vt/graph-model/graph'
import {
  classifyFindFileRequest,
  composeAppliedResponse,
  composeFindFileResponse,
  composeGraphResponse,
} from '../handleReadGraph.ts'

const NODE_ID = '/tmp/project/node.md'

function graphNodeFixture(): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: NODE_ID,
    contentWithoutYamlOrLinks: '# Node',
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
    },
  }
}

describe('handleReadGraph', () => {
  test('composes a schema-valid graph response', () => {
    const graph = createGraph({ [NODE_ID]: graphNodeFixture() })

    expect(composeGraphResponse(graph)).toEqual(expect.objectContaining({
      nodes: { [NODE_ID]: graph.nodes[NODE_ID] },
    }))
  })

  test('classifies find-file requests', () => {
    expect(classifyFindFileRequest({
      name: undefined,
      searchPath: '/tmp/project',
    })).toEqual({
      kind: 'error',
      message: 'Missing required query parameter: name',
      code: 'MISSING_NAME',
    })

    expect(classifyFindFileRequest({
      name: 'node',
      searchPath: null,
    })).toEqual({
      kind: 'error',
      message: 'No project is currently open',
      code: 'NO_PROJECT',
      status: 503,
    })

    expect(classifyFindFileRequest({
      name: 'node',
      searchPath: '/tmp/project',
    })).toEqual({
      kind: 'ok',
      name: 'node',
      searchPath: '/tmp/project',
    })
  })

  test('composes file search and undo responses', () => {
    expect(composeFindFileResponse(['/tmp/project/node.md'])).toEqual({
      matches: ['/tmp/project/node.md'],
    })
    expect(composeAppliedResponse(true)).toEqual({ applied: true })
  })
})
