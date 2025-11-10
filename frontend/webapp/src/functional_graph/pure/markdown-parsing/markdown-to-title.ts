import type { GraphNode } from '@/functional_graph/pure/types';
import { extractFrontmatter } from './extract-frontmatter';

/**
 * Compute the display title for a graph node
 *
 * Pure function: same input -> same output, no side effects
 *
 * Priority:
 * 1. Frontmatter title key (if present)
 * 2. First markdown heading (if < 100 chars)
 * 3. Filename with _ and - replaced by spaces
 *
 * @param node - The graph node to compute title for
 * @returns A human-readable title string
 *
 * @example
 * ```typescript
 * // With frontmatter
 * const node1 = { content: '---\ntitle: My Title\n---\nContent', relativeFilePathIsID: 'path/to/file.md', ... }
 * markdownToTitle(node1) // => "My Title"
 *
 * // With heading
 * const node2 = { content: '# Hello World\nContent', relativeFilePathIsID: 'path/to/file.md', ... }
 * markdownToTitle(node2) // => "Hello World"
 *
 * // Filename fallback
 * const node3 = { content: 'Plain content', relativeFilePathIsID: 'path/to/my-example_file.md', ... }
 * markdownToTitle(node3) // => "my example file"
 * ```
 */
export function markdownToTitle(node: GraphNode): string {
    const content = node.content;

    // 1. Check for frontmatter title
    const frontmatter = extractFrontmatter(content);
    if (frontmatter.title) {
        return frontmatter.title;
    }

    // 2. Check for first heading (one or more # followed by space and text)
    const headingMatch = content.match(/^#+\s+(.+)$/m);
    if (headingMatch) {
        const headingText = headingMatch[1].trim();
        if (headingText.length < 100) {
            return headingText;
        }
    }

    // 3. Use filename, clean up _ and -
    const filename = node.relativeFilePathIsID.split('/').pop() || node.relativeFilePathIsID;
    const withoutExtension = filename.replace(/\.md$/, '');
    return withoutExtension.replace(/[_-]/g, ' ');
}
