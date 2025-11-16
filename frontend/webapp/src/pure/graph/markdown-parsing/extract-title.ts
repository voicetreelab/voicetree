/**
 * Extracts the first markdown heading from content.
 *
 * Pure function: same input -> same output, no side effects
 *
 * @param content - Markdown content
 * @returns The first heading text (without #) or undefined if no heading found
 *
 * @example
 * ```typescript
 * extractTitle("# My Title\n\nContent here")
 * // => "My Title"
 *
 * extractTitle("## Second Level\n\nContent")
 * // => "Second Level"
 *
 * extractTitle("No heading here")
 * // => undefined
 * ```
 */
export function extractTitle(content: string): string | undefined {
  const headingMatch = content.match(/^#{1,6}\s+(.+)$/m)
  return headingMatch ? headingMatch[1].trim() : undefined
}