/**
 * Extracts parent-declaration refs from a markdown body.
 *
 * A parent declaration is a line whose trimmed prefix is `parent` (optionally
 * preceded by a list marker `-`, `*`, or `+`), followed by a wikilink. The
 * wikilink may carry an inline edge label after a pipe:
 *
 *   - parent [[name]]
 *   - parent [[name|edge label]]
 *
 * The pipe is always a separator on parent lines — there is no escape.
 *
 * Indentation and list markers are accepted symmetrically with `extractEdges`
 * in `./extract-edges.ts`, which derives the line's edge label by trimming the
 * line's prefix and stripping `^[-*+]\s+`. The grammars must agree, or a
 * round-trip strip + re-emit will desync (an indented parent line that the
 * strip misses but the edge parser catches would produce a duplicate parent
 * edge on the next read).
 *
 * Lines inside fenced code blocks (```…```) are skipped — code samples are
 * data, not graph wiring. `extractEdges` does NOT skip fences today (callers
 * who put `[[X]]` inside fences will still see edges); aligning both is a
 * separate concern.
 *
 * Pure string → data transform. Returns refs in document order.
 */

const PARENT_LINE_PATTERN: RegExp = /^[ \t]*(?:[-*+][ \t]+)?parent[ \t]+\[\[([^[\]\n\r]+)\]\][ \t]*$/

const FENCE_OPEN: RegExp = /^[ \t]*(```|~~~)/

export type ParentLineRef = {
    readonly filename: string
    readonly edgeLabel: string | undefined
}

/**
 * Normalize a parent-line wikilink target to the canonical comparison key:
 * strip leading `./`, collapse `\` to `/`, drop a trailing `.md` extension.
 * Mirrors graph-tools' `normalizeRef` minus the `path.posix.normalize` call,
 * which would resolve `..` segments — not desired here (a parent ref of
 * `../foo` resolves to a relative path the wikilink parser handles separately).
 */
function normalizeParentRefKey(target: string): string {
    const trimmed: string = target.trim()
    if (!trimmed) return ''
    const slashed: string = trimmed.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
    return slashed.replace(/\.md$/i, '')
}

/**
 * Same canonical key derivation as parent-line targets, applied to the
 * authoring-side `filename` field. Use this when building lookup keys for
 * in-batch parent resolution so that author input `parent.md` and a child's
 * `- parent [[parent]]` (or vice versa) compare equal.
 */
export function normalizeBatchFilenameKey(filename: string): string {
    return normalizeParentRefKey(filename)
}

export function extractParentRefs(markdown: string): readonly ParentLineRef[] {
    const refs: ParentLineRef[] = []
    const lines: readonly string[] = markdown.split(/\r?\n/)
    let inFence: boolean = false
    let fenceMarker: string | undefined

    for (const line of lines) {
        const openMatch: RegExpExecArray | null = FENCE_OPEN.exec(line)
        if (openMatch) {
            if (!inFence) {
                inFence = true
                fenceMarker = openMatch[1]
            } else if (fenceMarker && line.trim().startsWith(fenceMarker)) {
                inFence = false
                fenceMarker = undefined
            }
            continue
        }
        if (inFence) continue

        const match: RegExpExecArray | null = PARENT_LINE_PATTERN.exec(line)
        if (!match) continue

        const linkText: string = (match[1] ?? '').trim()
        if (!linkText) continue

        const pipeIndex: number = linkText.indexOf('|')
        const namePart: string = pipeIndex >= 0 ? linkText.slice(0, pipeIndex).trim() : linkText
        const labelPart: string | undefined = pipeIndex >= 0 ? linkText.slice(pipeIndex + 1).trim() : undefined

        const filename: string = normalizeParentRefKey(namePart)
        if (!filename) continue

        refs.push({
            filename,
            edgeLabel: labelPart && labelPart.length > 0 ? labelPart : undefined,
        })
    }

    return refs
}
