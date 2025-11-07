import matter from 'gray-matter'
import * as E from 'fp-ts/lib/Either.js'

/**
 * Frontmatter extracted from markdown files
 */
export interface Frontmatter {
    readonly node_id?: string
    readonly title?: string
    readonly summary?: string
    readonly color?: string
    readonly position?: { readonly x: number; readonly y: number }
    readonly error_parsing?: string
}

/**
 * Parses position object from frontmatter data
 * Returns undefined if position data is invalid or missing
 */
function parsePosition(position: unknown): { readonly x: number; readonly y: number } | undefined {
    if (!position || typeof position !== 'object') {
        return undefined
    }

    const pos = position as Record<string, unknown>

    // Check if x and y exist and are numbers
    if (typeof pos.x === 'number' && typeof pos.y === 'number') {
        return { x: pos.x, y: pos.y }
    }

    return undefined
}

/**
 * Safely parses YAML frontmatter, returning Either<Error, Frontmatter>
 */
function safeParseFrontmatter(content: string): E.Either<Error, Frontmatter> {
    return E.tryCatch(
        () => {
            const parsed = matter(content)
            return {
                node_id: normalizeToString(parsed.data.node_id),
                title: normalizeToString(parsed.data.title),
                summary: normalizeToString(parsed.data.summary),
                color: normalizeToString(parsed.data.color),
                position: parsePosition(parsed.data.position),
                error_parsing: undefined
            }
        },
        (error) => error as Error
    )
}

/**
 * Creates error frontmatter with error message
 */
function errorFrontmatter(error: Error): Frontmatter {
    return {
        node_id: undefined,
        title: undefined,
        summary: undefined,
        color: undefined,
        position: undefined,
        error_parsing: error.message
    }
}

/**
 * Extracts frontmatter from markdown content.
 *
 * Pure function: same input -> same output, no side effects
 * Gracefully handles malformed YAML by returning frontmatter with error_parsing field.
 *
 * @param content - The full markdown content including frontmatter
 * @returns Frontmatter object with optional fields. If YAML is malformed, error_parsing contains the error message.
 *
 * @example
 * ```typescript
 * const content = `---
 * node_id: "123"
 * title: "My GraphNode"
 * summary: "A test node"
 * color: "#FF0000"
 * position:
 *   x: 100
 *   y: 200
 * ---
 * # Content here`
 *
 * const fm = extractFrontmatter(content)
 * // fm = { node_id: "123", title: "My GraphNode", summary: "A test node", color: "#FF0000", position: { x: 100, y: 200 } }
 * ```
 */
export function extractFrontmatter(content: string): Frontmatter {
    const result = safeParseFrontmatter(content)

    return E.isLeft(result)
        ? errorFrontmatter(result.left)
        : result.right
}

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
