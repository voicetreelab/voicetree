import matter from 'gray-matter'

/**
 * Frontmatter extracted from markdown files
 */
export interface Frontmatter {
  readonly node_id?: string
  readonly title?: string
  readonly summary?: string
  readonly color?: string
}

/**
 * Extracts frontmatter from markdown content.
 *
 * Pure function: same input -> same output, no side effects
 * Fails fast if frontmatter is malformed - no error handling.
 *
 * @param content - The full markdown content including frontmatter
 * @returns Frontmatter object with optional fields
 * @throws Error if frontmatter YAML is malformed
 *
 * @example
 * ```typescript
 * const content = `---
 * node_id: "123"
 * title: "My Node"
 * summary: "A test node"
 * color: "#FF0000"
 * ---
 * # Content here`
 *
 * const fm = extractFrontmatter(content)
 * // fm = { node_id: "123", title: "My Node", summary: "A test node", color: "#FF0000" }
 * ```
 */
export function extractFrontmatter(content: string): Frontmatter {
  const parsed = matter(content)

  return {
    node_id: normalizeToString(parsed.data.node_id),
    title: normalizeToString(parsed.data.title),
    summary: normalizeToString(parsed.data.summary),
    color: normalizeToString(parsed.data.color)
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
