import type {GraphNode, NodeUIMetadata} from "@/functional_graph/pure/types.ts";
import * as O from 'fp-ts/lib/Option.js'
import matter from 'gray-matter'
import type {Frontmatter} from '@/functional_graph/pure/markdown_parsing/extract-frontmatter.ts'

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
    // 1. Extract existing frontmatter from content
    const parsed = matter(node.content);
    const contentFrontmatter = parsed.data as Partial<Frontmatter>;
    const contentWithoutFrontmatter = parsed.content;

    // 2. Merge frontmatter: nodeUIMetadata takes precedence over content frontmatter
    const mergedFrontmatter = mergeFrontmatter(contentFrontmatter, node.nodeUIMetadata);

    // 3. Append outgoing edges as wikilinks
    const wikilinks = node.outgoingEdges.length > 0
        ? '\n' + node.outgoingEdges.map(nodeId => `[[${nodeId}]]`).join('\n')
        : '';

    return `${mergedFrontmatter}${contentWithoutFrontmatter}${wikilinks}`;
}

/**
 * Merges frontmatter from content with nodeUIMetadata, with nodeUIMetadata taking precedence
 */
function mergeFrontmatter(contentFrontmatter: Partial<Frontmatter>, metadata: NodeUIMetadata): string {
    // Start with contentFrontmatter, then override with nodeUIMetadata
    const mergedData: Record<string, unknown> = { ...contentFrontmatter };

    // nodeUIMetadata.color takes precedence
    O.fold(
        () => {}, // no color in metadata, keep content frontmatter color if any
        (color: string) => { mergedData.color = color; }
    )(metadata.color);

    // nodeUIMetadata.position takes precedence
    O.fold(
        () => {}, // no position in metadata, keep content frontmatter position if any
        (pos: {readonly x: number; readonly y: number}) => {
            mergedData.position = { x: pos.x, y: pos.y };
        }
    )(metadata.position);

    // Build frontmatter string from merged data
    return buildFrontmatterFromData(mergedData);
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


