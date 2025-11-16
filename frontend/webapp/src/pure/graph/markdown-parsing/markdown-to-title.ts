import type {FilePath, NodeId} from '@/pure/graph';
import type {Frontmatter} from "@/pure/graph/markdown-parsing/extract-frontmatter.ts";

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
export function markdownToTitle(frontmatter: Frontmatter, content: string, filePath: FilePath): string {
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
    const filename = filePath.split('/').pop() || filePath;
    const withoutExtension = filename.replace(/\.md$/, '');
    return withoutExtension.replace(/[_-]/g, ' ');
}
