import type {GraphNode, NodeUIMetadata} from "@/pure/graph";
import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'

/**
 * Converts node content (without YAML) back to markdown with wikilinks restored.
 * Used for displaying in editors where YAML should NOT be shown.
 *
 * @param node - GraphNode containing contentWithoutYamlOrLinks
 * @returns Content with [link]* converted back to [[link]] wikilinks
 */
export function fromNodeToContentWithWikilinks(node: GraphNode): string {
    // Handle case where content might be undefined (new nodes)
    if (!node.contentWithoutYamlOrLinks) {
        return '';
    }
    // Convert [link]* placeholders back to [[link]] wikilinks
    return node.contentWithoutYamlOrLinks.replace(/\[([^\]]+)\]\*/g, '[[$1]]');
}

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
        return E.getOrElse(() => value as unknown)(E.tryCatch(
            () => JSON.parse(value) as unknown,
            () => value // On error, return original string
        ))
    }
    return value
}

/**
 * Checks if a value is an fp-ts Option type
 */
function isOption(value: unknown): value is O.Option<unknown> {
    return typeof value === 'object' && value !== null && '_tag' in value &&
        ((value as {readonly _tag: string})._tag === 'Some' || (value as {readonly _tag: string})._tag === 'None');
}

/**
 * Builds frontmatter string from NodeUIMetadata by dynamically iterating over all keys.
 * Note: title is NOT written to YAML - it's derived from Markdown content (single source of truth).
 */
function buildFrontmatterFromMetadata(metadata: NodeUIMetadata): string {
    // todo, do order determinisitcally, otherwhise yaml order will keep changing?

    // Build frontmatter from typed metadata fields
    // Note: title is excluded - Markdown content is the single source of truth for titles
    const typedFieldsData: Record<string, unknown> = Object.keys(metadata)
        .filter((key) => key !== 'additionalYAMLProps' && key !== 'title')
        .reduce((acc: Record<string, unknown>, key: string) => {
            const value: unknown = metadata[key as keyof NodeUIMetadata];

            if (isOption(value)) {
                return O.isSome(value) ? { ...acc, [key]: value.value } : acc;
            }

            return value !== undefined && value !== null ? { ...acc, [key]: value } : acc;
        }, {});

    // Add additional YAML properties
    const additionalData: Record<string, unknown> = Array.from(metadata.additionalYAMLProps.entries())
        .reduce((acc: Record<string, unknown>, [key, value]: readonly [string, string]) => ({
            ...acc,
            [key]: tryParseJSON(value)
        }), {});

    return buildFrontmatterFromData({ ...typedFieldsData, ...additionalData });
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
        const entries: readonly (readonly [string, unknown])[] = Object.entries(value)
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
    const entries: readonly (readonly [string, unknown])[] = Object.entries(data).filter(([, value]) => value !== undefined);

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


