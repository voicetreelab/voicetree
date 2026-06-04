/**
 * Pure, browser-safe basename for node IDs / file paths.
 *
 * Returns the final path segment, optionally stripping a trailing extension,
 * while PRESERVING original case. Equivalent to node's `path.basename(p, ext)`
 * for the paths graph-model deals with, but without importing the node `path`
 * module — graph-model is a pure library that must also run in the browser,
 * where `path` is externalized and throws on access.
 *
 * Handles both '/' and '\\' separators. As with node's `basename`, the
 * extension is only stripped when doing so leaves a non-empty segment (so a
 * segment that is exactly the extension, e.g. '.md', is returned unchanged).
 *
 * @example
 * nodeBasename('/project/a/Foo.md', '.md') => 'Foo'
 * nodeBasename('/project/a/Foo.md')        => 'Foo.md'
 * nodeBasename('Foo.md', '.md')            => 'Foo'
 */
export function nodeBasename(filePath: string, stripExtension?: string): string {
    const lastSeparator: number = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
    const segment: string = lastSeparator >= 0 ? filePath.slice(lastSeparator + 1) : filePath

    if (
        stripExtension &&
        segment.endsWith(stripExtension) &&
        segment.length > stripExtension.length
    ) {
        return segment.slice(0, segment.length - stripExtension.length)
    }
    return segment
}
