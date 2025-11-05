import type {Node, NodeId, NodeUIMetadata} from "@/functional_graph/pure/types.ts";
import * as O from 'fp-ts/lib/Option.js'

/**
 * Converts a Node to markdown file content with frontmatter and wikilinks
 *
 * Format:
 * ---
 * color: "#ff0000"  (optional)
 * position:
 *   x: 100
 *   y: 200
 * ---
 * <content>
 * [[child1]]
 * [[child2]]
 */
export function fromNodeToMarkdownContent(node: Node): string {
    // 1. Construct frontmatter from nodeUIMetadata
    const frontmatter = buildFrontmatter(node.nodeUIMetadata);

    // 2. Node content
    const content = node.content;

    // 3. Append outgoing edges as wikilinks
    const wikilinks = node.outgoingEdges.length > 0
        ? '\n' + node.outgoingEdges.map(nodeId => `[[${nodeId}]]`).join('\n')
        : '';

    return `${frontmatter}${content}${wikilinks}`;
}

function buildFrontmatter(metadata: NodeUIMetadata): string {
    const colorLine = O.fold(
        () => '',
        (color: string) => `color: ${color}\n`
    )(metadata.color);

    const position = `position:\n  x: ${metadata.position.x}\n  y: ${metadata.position.y}`;

    return `---\n${colorLine}${position}\n---\n`;
}


