import type {FilePath} from '@/pure/graph';

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
 * // With frontmatter title
 * markdownToTitle("My Title", content, 'path/to/file.md') // => "My Title"
 *
 * // With heading
 * markdownToTitle(undefined, '# Hello World\nContent', 'path/to/file.md') // => "Hello World"
 *
 * // With first line
 * markdownToTitle(undefined, 'Plain content line', 'path/to/file.md') // => "Plain content line"
 *
 * // Long heading truncated
 * markdownToTitle(undefined, '# ' + 'a'.repeat(250), 'path/to/file.md') // => "aaa...aaa..." (200 chars + "...")
 *
 * // Filename fallback
 * markdownToTitle(undefined, '', 'path/to/my-example_file.md') // => "my example file"
 * ```
 */
export function markdownToTitle(title: string | undefined, content: string, filePath: FilePath): string {
    if (title) {
        return title;
    }

    // Remove frontmatter from content for title extraction
    const contentWithoutFrontmatter: string = content.replace(/^---\n[\s\S]*?\n---\n/, '');

    // 2. Check for first heading (one or more # followed by space and text)
    const headingMatch: RegExpMatchArray | null = contentWithoutFrontmatter.match(/^#+\s+(.+)$/m);
    if (headingMatch) {
        const headingText: string = headingMatch[1].trim();
        if (headingText.length > 200) {
            return headingText.slice(0, 200) + '...';
        }
        return headingText;
    }

    // 3. Check for first non-empty line
    const firstNonEmptyLine: string | undefined = contentWithoutFrontmatter
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
    const filename: string = filePath.split('/').pop() ?? filePath;
    const withoutExtension: string = filename.replace(/\.md$/, '');
    return withoutExtension.replace(/[_-]/g, ' ');
}
