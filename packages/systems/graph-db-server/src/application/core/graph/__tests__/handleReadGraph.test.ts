import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, test } from 'vitest'
import { createGraph, type GraphNode } from '@vt/graph-model/graph'
import {
  classifyFindFileRequest,
  composeAppliedResponse,
  composeFindFileResponse,
  composeGraphResponse,
} from '../handleReadGraph.ts'

const NODE_ID = '/tmp/vault/node.md'

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
      searchPath: '/tmp/vault',
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
      message: 'No vault is currently open',
      code: 'NO_VAULT',
      status: 503,
    })

    expect(classifyFindFileRequest({
      name: 'node',
      searchPath: '/tmp/vault',
    })).toEqual({
      kind: 'ok',
      name: 'node',
      searchPath: '/tmp/vault',
    })
  })

  test('composes file search and undo responses', () => {
    expect(composeFindFileResponse(['/tmp/vault/node.md'])).toEqual({
      matches: ['/tmp/vault/node.md'],
    })
    expect(composeAppliedResponse(true)).toEqual({ applied: true })
  })
})
