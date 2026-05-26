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
 *   - `<paramName>`: <first line>
 *     <continuation indented two spaces — joined back with \n>
 *
 * Tools with no parameters omit the `**Parameters:**` block entirely.
 *
 * The header carries the CLI verb only. The MCP / RPC tool name is no longer
 * encoded here — the CLI surface is canonical and the mapping CLI verb ↔ RPC
 * name lives next to each subcommand spec (see `commands/runtime/agentSpecs.ts`
 * for the agent verbs, and the daemon's `tools/catalog.ts` for the full set).
 */

export type ManualParam = {
    readonly name: string
    readonly description: string
}

export type ManualTool = {
    readonly cliVerb: string
    readonly description: string
    readonly params: readonly ManualParam[]
}

const TOOL_HEADER: RegExp = /^### `([^`]+)`$/
const PARAM_BULLET: RegExp = /^- `([^`]+)`:(?: (.*))?$/

export function parseManual(markdown: string): readonly ManualTool[] {
    const lines: string[] = markdown.split('\n')
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
    let current: {name: string; descriptionLines: string[]} | null = null

    const flush: () => void = (): void => {
        if (!current) return
        const trimmed: string[] = stripTrailingEmpty(current.descriptionLines)
        params.push({name: current.name, description: trimmed.join('\n')})
        current = null
    }

    for (const rawLine of lines) {
        const bulletMatch: RegExpMatchArray | null = PARAM_BULLET.exec(rawLine)
        if (bulletMatch) {
            flush()
            current = {
                name: bulletMatch[1],
                descriptionLines: [bulletMatch[2] ?? ''],
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
