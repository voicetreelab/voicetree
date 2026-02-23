import type {FilePath} from '@/pure/graph';

const FRONTMATTER_REGEX: RegExp = /^---\n[\s\S]*?\n---\n/;
const HEADING_REGEX: RegExp = /^#+\s+(.+)$/m;

function stripFrontmatter(content: string): string {
    return content.replace(FRONTMATTER_REGEX, '');
}

/**
 * Compute the display title for a graph node from Markdown content.
 * Markdown is the single source of truth for node titles - YAML frontmatter title is ignored.
 *
 * Pure function: same input -> same output, no side effects
 *
 * Priority:
 * 1. First markdown heading (truncated to 200 chars + "..." if longer)
 * 2. First non-empty line of content (truncated to 200 chars + "..." if longer)
 * 3. Filename with _ and - replaced by spaces
 *
 * @returns A human-readable title string
 *
 * @example
 * ```typescript
 * // With heading
 * markdownToTitle('# Hello World\nContent', 'path/to/file.md') // => "Hello World"
 *
 * // With first line
 * markdownToTitle('Plain content line', 'path/to/file.md') // => "Plain content line"
 *
 * // Long heading truncated
 * markdownToTitle('# ' + 'a'.repeat(250), 'path/to/file.md') // => "aaa...aaa..." (200 chars + "...")
 *
 * // Filename fallback
 * markdownToTitle('', 'path/to/my-example_file.md') // => "my example file"
 * ```
 */
export function markdownToTitle(content: string, filePath: FilePath): string {

    // Handle undefined/null content gracefully - fall back to filename
    if (!content) {
        const filename: string = filePath.split(/[/\\]/).pop() ?? filePath;
        const withoutExtension: string = filename.replace(/\.md$/, '');
        return withoutExtension.replace(/[_-]/g, ' ');
    }

    // Remove frontmatter from content for title extraction
    const contentWithoutFrontmatter: string = stripFrontmatter(content);

    // 2. Check for first heading (one or more # followed by space and text)
    const headingMatch: RegExpMatchArray | null = contentWithoutFrontmatter.match(HEADING_REGEX);
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
        if (firstNonEmptyLine.length > 100) {
            return firstNonEmptyLine.slice(0, 100) + '...';
        }
        return firstNonEmptyLine;
    }

    // 4. Use filename, clean up _ and -
    const filename: string = filePath.split(/[/\\]/).pop() ?? filePath;
    const withoutExtension: string = filename.replace(/\.md$/, '');
    return withoutExtension.replace(/[_-]/g, ' ');
}

/**
 * Return markdown content with frontmatter and title line removed.
 * Companion to markdownToTitle — uses the same logic to identify the title line,
 * then returns everything after it.
 *
 * @example
 * contentAfterTitle('# My Title\n\nBody text here') // => '\n\nBody text here'
 * contentAfterTitle('First line\nSecond line')       // => '\nSecond line'
 */
export function contentAfterTitle(content: string): string {
    if (!content) return '';

    const withoutFrontmatter: string = stripFrontmatter(content);

    // If a heading exists, return everything after that line
    const headingMatch: RegExpMatchArray | null = withoutFrontmatter.match(HEADING_REGEX);
    if (headingMatch) {
        const headingLine: string = headingMatch[0];
        const headingIndex: number = withoutFrontmatter.indexOf(headingLine);
        return withoutFrontmatter.slice(headingIndex + headingLine.length);
    }

    // No heading — skip the first non-empty line (same as markdownToTitle fallback)
    const lines: readonly string[] = withoutFrontmatter.split('\n');
    const firstNonEmptyIndex: number = lines.findIndex((line: string) => line.trim().length > 0);
    if (firstNonEmptyIndex >= 0) {
        return lines.slice(firstNonEmptyIndex + 1).join('\n');
    }

    return '';
}

/**
 * Strip common markdown formatting to produce plain text for card previews.
 * Handles headings, bold, italic, inline code, links, list markers, and blockquotes.
 */
export function stripMarkdownFormatting(text: string): string {
    return text
        .replace(/^#+\s+/gm, '')                   // heading prefixes: ## text → text
        .replace(/\*\*(.+?)\*\*/g, '$1')           // bold: **text** → text
        .replace(/__(.+?)__/g, '$1')                // bold alt: __text__ → text
        .replace(/\*(.+?)\*/g, '$1')               // italic: *text* → text
        .replace(/_(.+?)_/g, '$1')                  // italic alt: _text_ → text
        .replace(/`(.+?)`/g, '$1')                  // inline code: `text` → text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // links: [text](url) → text
        .replace(/\[([^\]]+)\]\*/g, '$1')           // converted wikilinks: [text]* → text
        .replace(/^\s*[-*+]\s+/gm, '')              // unordered list markers
        .replace(/^\s*\d+\.\s+/gm, '')             // ordered list markers
        .replace(/^\s*>\s?/gm, '');                 // blockquotes
}
