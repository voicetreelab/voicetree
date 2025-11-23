import type {GraphNode, NodeUIMetadata} from "@/pure/graph";
import * as O from 'fp-ts/lib/Option.js'

/**
 * Converts a GraphNode to markdown file content with frontmatter and wikilinks
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
export function fromNodeToMarkdownContent(node: GraphNode): string {
    // 1. Build frontmatter from nodeUIMetadata (content no longer has frontmatter)
    const frontmatter = buildFrontmatterFromMetadata(node.nodeUIMetadata);

    // 2. Convert [link]* placeholders back to [[link]] wikilinks
    const contentWithWikilinks = node.contentWithoutYamlOrLinks.replace(/\[([^\]]+)\]\*/g, '[[$1]]');

    // 3. Append outgoing edges as wikilinks (only if not already in content)
    // After restoring wikilinks, check if the edge is already present
    const wikilinks = node.outgoingEdges
        .filter(edge => !contentWithWikilinks.includes(`[[${edge.targetId}]]`))
        .map(edge => (`[[${edge.targetId}]]`))
        .join('\n');

    const wikilinksSuffix = wikilinks.length > 0 ? '\n' + wikilinks : '';

    return `${frontmatter}${contentWithWikilinks}${wikilinksSuffix}`;
}

/**
 * Builds frontmatter string from NodeUIMetadata
 */
function buildFrontmatterFromMetadata(metadata: NodeUIMetadata): string {
    const frontmatterData: Record<string, unknown> = {};

    // Add color if present
    O.fold(
        () => {}, // no color
        (color: string) => { frontmatterData.color = color; }
    )(metadata.color);

    // Add position if present
    O.fold(
        () => {}, // no position
        (pos: {readonly x: number; readonly y: number}) => {
            frontmatterData.position = { x: pos.x, y: pos.y };
        }
    )(metadata.position);

    // Build frontmatter string from data
    return buildFrontmatterFromData(frontmatterData);
}

function buildFrontmatterFromData(data: Record<string, unknown>): string {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);

    if (entries.length === 0) {
        return '---\n---\n';
    }

    const frontmatterContent = entries.reduce((acc, [key, value]) => {
        if (key === 'position' && typeof value === 'object' && value !== null) {
            const pos = value as { readonly x: number; readonly y: number };
            return `${acc}position:\n  x: ${pos.x}\n  y: ${pos.y}\n`;
        } else if (typeof value === 'string') {
            // Colors (hex codes starting with #) don't need quotes in YAML
            // Quote strings that contain special YAML chars
            // Note: hyphens in the middle of strings are fine, only leading hyphens or other special positions need quotes
            const isHexColor = key === 'color' && /^#[0-9A-Fa-f]{6}$/.test(value);
            const needsQuotes = !isHexColor && /[:{}[\],&*#?|<>=!%@`]/.test(value);
            return `${acc}${key}: ${needsQuotes ? `"${value}"` : value}\n`;
        } else {
            return `${acc}${key}: ${value}\n`;
        }
    }, '');

    return `---\n${frontmatterContent}---\n`;
}


