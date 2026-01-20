import * as O from 'fp-ts/lib/Option.js'
import * as E from 'fp-ts/lib/Either.js'
import matter from 'gray-matter'
import type {Graph, GraphNode, Edge} from '@/pure/graph'
import {NODE_UI_METADATA_YAML_KEYS} from '@/pure/graph'
import {filenameToNodeId} from '@/pure/graph/markdown-parsing/filename-utils'
import {extractEdges} from "@/pure/graph/markdown-parsing/extract-edges";

/**
 * Parses markdown content into a GraphNode.
 *
 * Pure function: same input -> same output, no side effects
 *
 * @param content - Full markdown content including frontmatter
 * @param filename - Filename of the markdown file (used as fallback for node_id)
 * @returns GraphNode with all fields populated
 *
 * Field resolution:
 * - relativeFilePathIsID: filenameToNodeId(filename)
 * - title: NOT stored in GraphNode - derived via getNodeTitle(node) when needed
 * - content: full markdown content
 * - color: Option.some(frontmatter.color) | Option.none
 * - position: Option.some(frontmatter.position) | Option.none
 *
 * @example
 * ```typescript
 * const content = `---
 * color: "#FF0000"
 * position:
 *   x: 100
 *   y: 200
 * ---
 * # My Title
 * Content here`
 *
 * const node = parseMarkdownToGraphNode(content, "test.md")
 * // node = {
 * //   relativeFilePathIsID: "test",
 * //   content: content,
 * //   color: O.some("#FF0000"),
 * //   position: O.some({ x: 100, y: 200 })
 * // }
 * // To get title: getNodeTitle(node) => "My Title"
 * ```
 */

/**
 * Normalizes a value to a string or undefined.
 * Handles YAML parsing quirks where numbers might be returned.
 */
function normalizeToString(value: unknown): string | undefined {
    if (value === null || value === undefined) {
        return undefined
    }
    return String(value)
}

/**
 * Parses position object from frontmatter data
 * Returns undefined if position data is invalid or missing
 */ // todo why do we need a custom parsePosition? why can't we just detect it's an object and parse it???
 // todo, this whole file defs needs to be reworked.
function parsePosition(position: unknown): { readonly x: number; readonly y: number } | undefined {
    if (!position || typeof position !== 'object') {
        return undefined
    }

    const pos: Record<string, unknown> = position as Record<string, unknown>

    // Check if x and y exist and are numbers
    if (typeof pos.x === 'number' && typeof pos.y === 'number') {
        return { x: pos.x, y: pos.y }
    }

    return undefined
}

/**
 * Convert any value to a string representation.
 * - Primitives (string, number, boolean) are converted directly
 * - Arrays and objects are converted via JSON.stringify
 */
function valueToString(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
    }
    // For arrays and objects, use JSON
    return JSON.stringify(value)
}

/**
 * Extract YAML properties, excluding keys that have explicit typed fields in NodeUIMetadata.
 */
function extractAdditionalYAMLProps(
    rawYAMLData: Record<string, unknown>,
    keysWithExplicitFields: ReadonlySet<string>
): ReadonlyMap<string, string> {
    const additionalProps: ReadonlyMap<string, string> = Object.entries(rawYAMLData).reduce((acc, [key, value]) => {
        if (!keysWithExplicitFields.has(key) && value !== undefined && value !== null) {
            acc.set(key, valueToString(value))
        }
        return acc
    }, new Map<string, string>())

    return additionalProps
}

// filename can be relative or absolute, prefer relative to watched vault.
export function parseMarkdownToGraphNode(content: string, filename: string, graph : Graph): GraphNode {
    // Parse markdown and extract YAML frontmatter (with error handling for invalid YAML)
    const parseResult: E.Either<unknown, matter.GrayMatterFile<string>> = E.tryCatch(
        () => matter(content),
        (error) => {
            console.warn(`[parseMarkdownToGraphNode] Invalid YAML in ${filename}, using fallback:`, error)
            return error
        }
    )
    const parsed: { readonly content: string; readonly data: Record<string, unknown>; } = E.getOrElse(() => ({ content, data: {} as Record<string, unknown> }))(parseResult)
    const contentWithoutFrontmatter: string = parsed.content

    // Extract frontmatter fields directly from raw YAML data
    // Note: title is NOT read from YAML - Markdown is the single source of truth for titles
    const color: string | undefined = normalizeToString(parsed.data.color)
    const position: { readonly x: number; readonly y: number; } | undefined = parsePosition(parsed.data.position)
    // NOTE: title is NOT stored in nodeUIMetadata - use getNodeTitle(node) to derive it when needed
    // Read isContextNode from frontmatter (explicit, not derived)
    const isContextNode: boolean = parsed.data.isContextNode === true


    // Extract edges from original content (before stripping wikilinks)
    const edges: readonly Edge[] = extractEdges(content, graph.nodes)

    // Replace [[link]] with [link]* (strip wikilink syntax)
    const contentWithoutYamlOrLinks: string = contentWithoutFrontmatter.replace(/\[\[([^\]]+)\]\]/g, '[$1]*')

    // Read containedNodeIds from frontmatter (array of node IDs whose content is in this context node)
    // Note: These are already normalized when written (from graph node IDs which use filenameToNodeId)
    const containedNodeIds: readonly string[] | undefined = Array.isArray(parsed.data.containedNodeIds)
        ? parsed.data.containedNodeIds.filter((id): id is string => typeof id === 'string')
        : undefined

    // Extract additional YAML properties, excluding keys that have explicit fields in NodeUIMetadata
    const additionalYAMLProps: ReadonlyMap<string, string> = extractAdditionalYAMLProps(parsed.data, NODE_UI_METADATA_YAML_KEYS)

    // Return node (title is derived via getNodeTitle when needed, not stored)
    return {
        absoluteFilePathIsID: filenameToNodeId(filename),
        outgoingEdges: edges,
        contentWithoutYamlOrLinks,
        nodeUIMetadata: {
            color: color ? O.some(color) : O.none,
            position: position ? O.some(position) : O.none,
            additionalYAMLProps,
            isContextNode,
            containedNodeIds
        }
    }
}
