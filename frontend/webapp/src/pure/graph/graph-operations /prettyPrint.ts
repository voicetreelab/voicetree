import type { Graph, GraphNode, GraphDelta } from '@/pure/graph';
import * as O from 'fp-ts/lib/Option.js';

/**
 * Pretty print a graph for debugging
 */
export function prettyPrintGraph(graph: Graph): string {
  const header = [
    '='.repeat(60),
    `GRAPH STATE (${Object.keys(graph.nodes).length} nodes)`,
    '='.repeat(60)
  ];

  const nodeLines = Object.entries(graph.nodes).flatMap(([nodeId, node]) => {
    const posStr = O.isSome(node.nodeUIMetadata.position)
      ? `(${node.nodeUIMetadata.position.value.x}, ${node.nodeUIMetadata.position.value.y})`
      : 'none';

    return [
      `\n[${nodeId}]`,
      `  Content: ${node.content.substring(0, 50)}...`,
      `  Outgoing edges: [${node.outgoingEdges.join(', ')}]`,
      `  Position: ${posStr}`
    ];
  });

  const footer = ['\n' + '='.repeat(60)];

  return [...header, ...nodeLines, ...footer].join('\n');
}

/**
 * Pretty print a single node for debugging
 */
export function prettyPrintNode(node: GraphNode): string {
  const posStr = O.isSome(node.nodeUIMetadata.position)
    ? `(${node.nodeUIMetadata.position.value.x}, ${node.nodeUIMetadata.position.value.y})`
    : 'none';

  return `Node[${node.relativeFilePathIsID}]:
  Content: ${node.content.substring(0, 100)}
  Outgoing edges: [${node.outgoingEdges.join(', ')}]
  Position: ${posStr}`;
}

/**
 * Pretty print a GraphDelta for debugging
 */
export function prettyPrintGraphDelta(delta: GraphDelta): string {
  if (delta.length === 0) {
    return 'GraphDelta: []';
  }

  const header = [`GraphDelta (${delta.length} operations):`];

  const operationLines = delta.flatMap((nodeDelta, index) => {
    if (nodeDelta.type === 'UpsertNode') {
      const node = nodeDelta.nodeToUpsert;
      const contentPreview = node.content.substring(0, 50).replace(/\n/g, ' ');
      return [
        `  ${index + 1}. UpsertNode: ${node.relativeFilePathIsID}`,
        `     Content: "${contentPreview}${node.content.length > 50 ? '...' : ''}"`,
        `     Edges: [${node.outgoingEdges.join(', ')}]`
      ];
    } else {
      return [`  ${index + 1}. DeleteNode: ${nodeDelta.nodeId}`];
    }
  });

  return [...header, ...operationLines].join('\n');
}
