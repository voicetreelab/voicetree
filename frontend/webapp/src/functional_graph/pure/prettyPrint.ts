import type { Graph, Node, GraphDelta } from './types';

/**
 * Pretty print a graph for debugging
 */
export function prettyPrintGraph(graph: Graph): string {
  const header = [
    '='.repeat(60),
    `GRAPH STATE (${Object.keys(graph.nodes).length} nodes)`,
    '='.repeat(60)
  ];

  const nodeLines = Object.entries(graph.nodes).flatMap(([nodeId, node]) => [
    `\n[${nodeId}]`,
    `  Content: ${node.content.substring(0, 50)}...`,
    `  Outgoing edges: [${node.outgoingEdges.join(', ')}]`,
    `  Position: (${node.nodeUIMetadata.position.x}, ${node.nodeUIMetadata.position.y})`
  ]);

  const footer = ['\n' + '='.repeat(60)];

  return [...header, ...nodeLines, ...footer].join('\n');
}

/**
 * Pretty print a single node for debugging
 */
export function prettyPrintNode(node: Node): string {
  return `Node[${node.relativeFilePathIsID}]:
  Content: ${node.content.substring(0, 100)}
  Outgoing edges: [${node.outgoingEdges.join(', ')}]
  Position: (${node.nodeUIMetadata.position.x}, ${node.nodeUIMetadata.position.y})`;
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
