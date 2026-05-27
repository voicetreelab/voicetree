import * as O from 'fp-ts/lib/Option.js'
import type { GraphDelta, GraphNode } from '@vt/graph-model'

export function makeNode(absolutePath: string, content: string, agentName = 'e2e'): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: absolutePath,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map([['agent_name', agentName]]),
    },
  }
}

export function upsertDelta(node: GraphNode): GraphDelta {
  return [upsertNode(node)]
}

export function upsertNode(node: GraphNode): GraphDelta[number] {
  return { type: 'UpsertNode', nodeToUpsert: node, previousNode: O.none }
}
