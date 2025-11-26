import type {GraphNode, NodeUIMetadata} from "@/pure/graph";
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'

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
    const frontmatter: string = buildFrontmatterFromMetadata(node.nodeUIMetadata);

    // 2. Convert [link]* placeholders back to [[link]] wikilinks
    const contentWithWikilinks: string = node.contentWithoutYamlOrLinks.replace(/\[([^\]]+)\]\*/g, '[[$1]]');

    // 3. Append outgoing edges as wikilinks (only if not already in content)
    // After restoring wikilinks, check if the edge is already present
    const wikilinks: string = node.outgoingEdges
        .filter(edge => !contentWithWikilinks.includes(`[[${edge.targetId}]]`))
        .map(edge => (`[[${edge.targetId}]]`))
        .join('\n');

    const wikilinksSuffix: string = wikilinks.length > 0 ? '\n' + wikilinks : '';

    return `${frontmatter}${contentWithWikilinks}${wikilinksSuffix}`;
}

/**
 * Attempts to parse a string as JSON, returning the parsed value or the original string.
 */
 // todo seems awful way of doing it
function tryParseJSON(value: string): unknown {
    // Try to detect if this is likely JSON (starts with [ or {)
    if ((value.startsWith('[') && value.endsWith(']')) ||
        (value.startsWith('{') && value.endsWith('}'))) {
        const parseResult: E.Either<string, any> = E.tryCatch(
            () => JSON.parse(value),
            () => value // On error, return original string
        )
        return E.getOrElse(() => value)(parseResult)
    }
    return value
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

    // Add isContextNode if true (only write when true to keep frontmatter clean)
    if (metadata.isContextNode) {
        frontmatterData.isContextNode = true;
    }

    // Add additional YAML properties (these don't include color/position/isContextNode
    // since those have explicit typed fields and aren't stored in additionalYAMLProps)
    metadata.additionalYAMLProps.forEach((value, key) => {
        // Try to parse JSON strings back to their original structure
        frontmatterData[key] = tryParseJSON(value)
    })

    // Build frontmatter string from data
    return buildFrontmatterFromData(frontmatterData);
}

/**
 * Convert a value to YAML string representation with proper indentation
 */
 // todo this feels unnecessary
function valueToYAML(value: unknown, indent: string = ''): string {
    if (value === null || value === undefined) {
        return 'null'
    }

    if (typeof value === 'string') {
        return value
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
    }

    if (Array.isArray(value)) {
        // Convert array to YAML list format
        return value.reduce((acc, item) => {
            const itemValue: string = typeof item === 'string' ? item : String(item)
            return `${acc}\n${indent}- ${itemValue}`
        }, '')
    }

    if (typeof value === 'object') {
        // Convert object to nested YAML
        const entries: [string, any][] = Object.entries(value)
        return entries.reduce((acc, [k, v]) => {
            const nestedValue: string = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
                ? String(v)
                : valueToYAML(v, indent + '  ')
            return `${acc}\n${indent}${k}: ${nestedValue}`
        }, '')
    }

    return String(value)
}

function buildFrontmatterFromData(data: Record<string, unknown>): string {
    const entries: [string, unknown][] = Object.entries(data).filter(([, value]) => value !== undefined);

    if (entries.length === 0) {
        return '---\n---\n';
    }

    const frontmatterContent: string = entries.reduce((acc, [key, value]) => {
        if (key === 'position' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const pos: { readonly x: number; readonly y: number; } = value as { readonly x: number; readonly y: number };
            return `${acc}position:\n  x: ${pos.x}\n  y: ${pos.y}\n`;
        } else if (typeof value === 'string') {
            // Colors (hex codes starting with #) don't need quotes in YAML
            // Quote strings that contain special YAML chars
            const isHexColor: boolean = key === 'color' && /^#[0-9A-Fa-f]{6}$/.test(value);
            const needsQuotes: boolean = !isHexColor && /[:{}[\],&*#?|<>=!%@`]/.test(value);
            return `${acc}${key}: ${needsQuotes ? `"${value}"` : value}\n`;
        } else if (typeof value === 'number' || typeof value === 'boolean') {
            return `${acc}${key}: ${value}\n`;
        } else if (Array.isArray(value)) {
            const yamlArray: string = valueToYAML(value, '  ')
            return `${acc}${key}:${yamlArray}\n`;
        } else if (typeof value === 'object' && value !== null) {
            const yamlObject: string = valueToYAML(value, '  ')
            return `${acc}${key}:${yamlObject}\n`;
        } else {
            return `${acc}${key}: ${value}\n`;
        }
    }, '');

    return `---\n${frontmatterContent}---\n`;
}


