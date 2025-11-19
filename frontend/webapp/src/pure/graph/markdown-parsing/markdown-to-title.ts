import type {FilePath} from '@/pure/graph';
import type {Frontmatter} from "@/pure/graph/markdown-parsing/extract-frontmatter.ts";

/**
 * Compute the display title for a graph node
 *
 * Pure function: same input -> same output, no side effects
 *
 * Priority:
 * 1. Frontmatter title key (if present)
 * 2. First markdown heading (truncated to 200 chars + "..." if longer)
 * 3. First non-empty line of content (truncated to 200 chars + "..." if longer)
 * 4. Filename with _ and - replaced by spaces
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
 * // With first line
 * const node3 = { content: 'Plain content line', relativeFilePathIsID: 'path/to/file.md', ... }
 * markdownToTitle(node3) // => "Plain content line"
 *
 * // Long heading truncated
 * const node4 = { content: '# ' + 'a'.repeat(250), relativeFilePathIsID: 'path/to/file.md', ... }
 * markdownToTitle(node4) // => "aaa...aaa..." (200 chars + "...")
 *
 * // Filename fallback
 * const node5 = { content: '', relativeFilePathIsID: 'path/to/my-example_file.md', ... }
 * markdownToTitle(node5) // => "my example file"
 * ```
 */
export function markdownToTitle(frontmatter: Frontmatter, content: string, filePath: FilePath): string {
    if (frontmatter.title) {
        return frontmatter.title;
    }

    // Remove frontmatter from content for title extraction
    const contentWithoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n/, '');

    // 2. Check for first heading (one or more # followed by space and text)
    const headingMatch = contentWithoutFrontmatter.match(/^#+\s+(.+)$/m);
    if (headingMatch) {
        const headingText = headingMatch[1].trim();
        if (headingText.length > 200) {
            return headingText.slice(0, 200) + '...';
        }
        return headingText;
    }

    // 3. Check for first non-empty line
    const firstNonEmptyLine = contentWithoutFrontmatter
        .split('\n')
        .map(line => line.trim())
        .find(line => line.length > 0);

    if (firstNonEmptyLine) {
        if (firstNonEmptyLine.length > 200) {
            return firstNonEmptyLine.slice(0, 200) + '...';
        }
        return firstNonEmptyLine;
    }

    // 4. Use filename, clean up _ and -
    const filename = filePath.split('/').pop() ?? filePath;
    const withoutExtension = filename.replace(/\.md$/, '');
    return withoutExtension.replace(/[_-]/g, ' ');
}
