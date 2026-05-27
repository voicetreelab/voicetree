/**
 * Pure parser for the canonical CLI manual (`prompts/cli-manual.md` in this
 * package). Splits the file into `ManualTool` entries that the drift check and
 * `vt manual` command can both consume. Format (every rule is enforced by the
 * drift check — drift will fail the test rather than silently mis-parse):
 *
 *   ### `<vt cli verb>`
 *
 *   <multi-line description in markdown>
 *
 *   **Parameters:**
 *
 *   - `<paramName>`: <single-line description>
 *   - `<paramName>` (<annotation>): <single-line description>
 *   - `<paramName>`: <first line>
 *     <continuation indented two spaces — joined back with \n>
 *
 * The optional `(<annotation>)` between the backticked name and the colon
 * carries the JSON-RPC parameter name (e.g. `(RPC: agentName)`), positional
 * marker (e.g. `(positional)`), or a combination (e.g. `(positional, RPC: …)`).
 * The CLI surface is canonical; the annotation makes the verb ↔ RPC mapping
 * explicit without polluting the param name token.
 *
 * Tools with no parameters omit the `**Parameters:**` block entirely.
 */

export type ManualParam = {
    readonly name: string
    readonly annotation: string
    readonly description: string
}

export type ManualTool = {
    readonly cliVerb: string
    readonly description: string
    readonly params: readonly ManualParam[]
}

const TOOL_HEADER: RegExp = /^### `([^`]+)`$/
const PARAM_BULLET: RegExp = /^- `([^`]+)`(?:\s+\(([^)]+)\))?:(?: (.*))?$/
const SINGLE_LINE_HTML_COMMENT: RegExp = /^<!--.*-->$/
const HTML_COMMENT_OPEN: RegExp = /^<!--/
const HTML_COMMENT_CLOSE: RegExp = /-->\s*$/

export function parseManual(markdown: string): readonly ManualTool[] {
    const lines: string[] = stripHtmlCommentLines(markdown.split('\n'))
    const tools: ManualTool[] = []

    let cursor: number = 0
    while (cursor < lines.length) {
        const headerMatch: RegExpMatchArray | null = TOOL_HEADER.exec(lines[cursor])
        if (!headerMatch) {
            cursor += 1
            continue
        }

        const cliVerb: string = headerMatch[1]
        cursor += 1

        const sectionEnd: number = findNextHeader(lines, cursor)
        const sectionLines: string[] = lines.slice(cursor, sectionEnd)
        const split: SectionSplit = splitDescriptionAndParams(sectionLines)
        tools.push({
            cliVerb,
            description: split.description,
            params: split.params,
        })
        cursor = sectionEnd
    }

    return tools
}

/**
 * Drop CommonMark HTML comments that occupy whole lines. Both the
 * single-line form (`<!-- foo -->`) and the multi-line block form
 * (`<!--\n foo\n-->`) are removed entirely so the section/parameter walkers
 * never see them. Inline comments embedded inside a content line are left
 * untouched — only lines whose trimmed form is purely a comment are dropped.
 */
function stripHtmlCommentLines(lines: readonly string[]): string[] {
    const kept: string[] = []
    let insideBlockComment: boolean = false
    for (const line of lines) {
        const trimmed: string = line.trim()
        if (insideBlockComment) {
            if (HTML_COMMENT_CLOSE.test(trimmed)) insideBlockComment = false
            continue
        }
        if (SINGLE_LINE_HTML_COMMENT.test(trimmed)) continue
        if (HTML_COMMENT_OPEN.test(trimmed) && !HTML_COMMENT_CLOSE.test(trimmed)) {
            insideBlockComment = true
            continue
        }
        kept.push(line)
    }
    return kept
}

function findNextHeader(lines: readonly string[], from: number): number {
    for (let index: number = from; index < lines.length; index += 1) {
        if (TOOL_HEADER.test(lines[index])) return index
        if (lines[index].startsWith('## ') && !lines[index].startsWith('### ')) return index
    }
    return lines.length
}

type SectionSplit = {
    readonly description: string
    readonly params: readonly ManualParam[]
}

function splitDescriptionAndParams(sectionLines: readonly string[]): SectionSplit {
    const paramHeaderIndex: number = sectionLines.findIndex((line: string): boolean => line === '**Parameters:**')
    if (paramHeaderIndex === -1) {
        return {description: trimSurroundingBlankLines(sectionLines).join('\n'), params: []}
    }

    const descriptionLines: readonly string[] = sectionLines.slice(0, paramHeaderIndex)
    const paramLines: readonly string[] = sectionLines.slice(paramHeaderIndex + 1)
    return {
        description: trimSurroundingBlankLines(descriptionLines).join('\n'),
        params: parseParamBullets(paramLines),
    }
}

function trimSurroundingBlankLines(lines: readonly string[]): readonly string[] {
    let start: number = 0
    let end: number = lines.length
    while (start < end && lines[start].trim() === '') start += 1
    while (end > start && lines[end - 1].trim() === '') end -= 1
    return lines.slice(start, end)
}

function stripTrailingEmpty(lines: readonly string[]): string[] {
    const result: string[] = lines.slice()
    while (result.length > 0 && result[result.length - 1] === '') {
        result.pop()
    }
    return result
}

function parseParamBullets(lines: readonly string[]): readonly ManualParam[] {
    const params: ManualParam[] = []
    let current: {name: string; annotation: string; descriptionLines: string[]} | null = null

    const flush: () => void = (): void => {
        if (!current) return
        const trimmed: string[] = stripTrailingEmpty(current.descriptionLines)
        params.push({
            name: current.name,
            annotation: current.annotation,
            description: trimmed.join('\n'),
        })
        current = null
    }

    for (const rawLine of lines) {
        const bulletMatch: RegExpMatchArray | null = PARAM_BULLET.exec(rawLine)
        if (bulletMatch) {
            flush()
            current = {
                name: bulletMatch[1],
                annotation: bulletMatch[2] ?? '',
                descriptionLines: [bulletMatch[3] ?? ''],
            }
            continue
        }

        if (current === null) {
            if (rawLine.trim() === '') continue
            throw new Error(`parseManual: unexpected line in parameter block: ${JSON.stringify(rawLine)}`)
        }

        if (rawLine.startsWith('  ')) {
            current.descriptionLines.push(rawLine.slice(2))
            continue
        }

        if (rawLine.trim() === '') {
            current.descriptionLines.push('')
            continue
        }

        throw new Error(`parseManual: unexpected dedented continuation line: ${JSON.stringify(rawLine)}`)
    }

    flush()
    return params
}
