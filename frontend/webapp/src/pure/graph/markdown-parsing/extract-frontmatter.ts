import matter from 'gray-matter'

/**
 * Frontmatter extracted from markdown files
 */
export interface Frontmatter {
    readonly node_id?: string
    readonly title?: string
    readonly summary?: string
    readonly color?: string
    readonly position?: { readonly x: number; readonly y: number }
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
 * Extracts frontmatter from markdown content.
 *
 * Pure function: same input -> same output, no side effects
 * Returns empty frontmatter if YAML is malformed (functional recovery without try-catch).
 *
 * @param content - The full markdown content including frontmatter
 * @returns Frontmatter object with optional fields
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
    const parsed = matter(content)
    return {
        node_id: normalizeToString(parsed.data.node_id),
        title: normalizeToString(parsed.data.title),
        summary: normalizeToString(parsed.data.summary),
        color: normalizeToString(parsed.data.color),
        position: parsePosition(parsed.data.position)
    }
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
