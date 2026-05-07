import path from 'path'

export const DEFAULT_AUTHORING_COLOR = 'blue'
export const DEFAULT_AUTHORING_MAX_BODY_LINES = 70

export type AuthoringFixCode =
    | 'added_frontmatter'
    | 'completed_frontmatter'
    | 'normalized_line_endings'
    | 'trimmed_trailing_whitespace'
    | 'converted_structural_soft_links'

export type AuthoringFix = {
    readonly code: AuthoringFixCode
    readonly message: string
}

export type AuthoringRejectionCode = 'missing_title' | 'node_too_long'

export type AuthoringRejection = {
    readonly code: AuthoringRejectionCode
    readonly message: string
    readonly suggestions: readonly string[]
}

export function prepareAuthoringMarkdown(params: {
    readonly filename: string
    readonly markdown: string
    readonly agentName?: string
    readonly defaultColor?: string
    readonly maxBodyLines?: number
}): {
    readonly markdown: string
    readonly fixes: readonly AuthoringFix[]
    readonly rejections: readonly AuthoringRejection[]
} {
    let markdown: string = params.markdown
    const fixes: AuthoringFix[] = []

    if (markdown.includes('\r\n')) {
        markdown = markdown.replace(/\r\n/g, '\n')
        fixes.push({
            code: 'normalized_line_endings',
            message: 'Normalized CRLF line endings.',
        })
    }

    const trimmedTrailingWhitespace: { readonly markdown: string; readonly lineCount: number } =
        trimTrailingWhitespace(markdown)
    markdown = trimmedTrailingWhitespace.markdown
    if (trimmedTrailingWhitespace.lineCount > 0) {
        fixes.push({
            code: 'trimmed_trailing_whitespace',
            message: `Trimmed trailing whitespace on ${trimmedTrailingWhitespace.lineCount} line(s).`,
        })
    }

    const convertedSoftLinks: { readonly markdown: string; readonly count: number } = convertStructuralSoftLinks(markdown)
    markdown = convertedSoftLinks.markdown
    if (convertedSoftLinks.count > 0) {
        fixes.push({
            code: 'converted_structural_soft_links',
            message: `Converted ${convertedSoftLinks.count} structural soft link(s) from [x] to [[x]].`,
        })
    }

    const {frontmatterLines, body} = splitFrontmatter(markdown)
    const mergedFrontmatterLines: string[] = mergeFrontmatter(frontmatterLines, {
        color: params.defaultColor ?? DEFAULT_AUTHORING_COLOR,
        agent_name: params.agentName,
        isContextNode: 'false',
    })
    const addedFrontmatterKeys: string[] = getAddedFrontmatterKeys(frontmatterLines, mergedFrontmatterLines)

    if (addedFrontmatterKeys.length > 0) {
        fixes.push({
            code: frontmatterLines.length === 0 ? 'added_frontmatter' : 'completed_frontmatter',
            message: `${frontmatterLines.length === 0 ? 'Added' : 'Completed'} frontmatter (${addedFrontmatterKeys.join(', ')}).`,
        })
    }

    const normalizedBody: string = body.trimEnd()
    const rebuiltMarkdown: string = buildMarkdownFromParts(mergedFrontmatterLines, normalizedBody)

    return {
        markdown: rebuiltMarkdown,
        fixes,
        rejections: validatePreparedMarkdown({
            filename: params.filename,
            markdown: rebuiltMarkdown,
            maxBodyLines: params.maxBodyLines ?? DEFAULT_AUTHORING_MAX_BODY_LINES,
        }),
    }
}

export function buildMarkdownFromParts(frontmatterLines: readonly string[], body: string): string {
    const sections: string[] = []

    if (frontmatterLines.length > 0) {
        sections.push(['---', ...frontmatterLines, '---'].join('\n'))
    }

    if (body.length > 0) {
        sections.push(body)
    }

    return sections.length > 0 ? `${sections.join('\n\n')}\n` : ''
}

export function splitFrontmatter(markdown: string): { readonly frontmatterLines: readonly string[]; readonly body: string } {
    if (!markdown.startsWith('---\n')) {
        return {frontmatterLines: [], body: markdown}
    }

    const lines: string[] = markdown.split('\n')
    const closingIndex: number = lines.findIndex((line, index) => index > 0 && line === '---')
    if (closingIndex === -1) {
        return {frontmatterLines: [], body: markdown}
    }

    const body: string = lines.slice(closingIndex + 1).join('\n').replace(/^\n/, '')
    return {
        frontmatterLines: lines.slice(1, closingIndex),
        body,
    }
}

export function mergeFrontmatter(
    frontmatterLines: readonly string[],
    additions: Readonly<Record<string, string | undefined>>
): string[] {
    const mergedFrontmatterLines: string[] = [...frontmatterLines]
    const existingKeys: Set<string> = new Set(frontmatterKeys(frontmatterLines))

    for (const [key, value] of Object.entries(additions)) {
        if (!value || existingKeys.has(key)) {
            continue
        }
        mergedFrontmatterLines.push(`${key}: ${value}`)
    }

    return mergedFrontmatterLines
}

export function extractExistingParentRefs(markdown: string): Set<string> {
    const refs: Set<string> = new Set()

    for (const match of markdown.matchAll(/^- parent \[\[([^[\]]+)\]\]$/gm)) {
        const ref: string = normalizeRef(match[1] ?? '')
        if (ref) {
            refs.add(ref)
        }
    }

    return refs
}

export function normalizeFilename(filename: string): string {
    const normalized: string = path.posix.normalize(filename.replace(/\\/g, '/'))
    return normalized.replace(/^(?:\.\/)+/, '')
}

export function normalizeRef(ref: string): string {
    return normalizeFilename(ref.trim()).replace(/\.md$/i, '')
}

export function normalizeMarkdown(markdown: string): string {
    return markdown.replace(/\r\n/g, '\n')
}

function frontmatterKeys(frontmatterLines: readonly string[]): string[] {
    return frontmatterLines
        .map(line => /^([A-Za-z0-9_-]+):/.exec(line)?.[1])
        .filter((key): key is string => Boolean(key))
}

function getAddedFrontmatterKeys(
    originalFrontmatterLines: readonly string[],
    mergedFrontmatterLines: readonly string[]
): string[] {
    const originalKeys: Set<string> = new Set(frontmatterKeys(originalFrontmatterLines))

    return frontmatterKeys(mergedFrontmatterLines).filter(key => !originalKeys.has(key))
}

function trimTrailingWhitespace(markdown: string): { readonly markdown: string; readonly lineCount: number } {
    let lineCount: number = 0
    const trimmedLines: string[] = markdown.split('\n').map(line => {
        const trimmedLine: string = line.replace(/[ \t]+$/u, '')
        if (trimmedLine !== line) {
            lineCount += 1
        }
        return trimmedLine
    })

    return {
        markdown: trimmedLines.join('\n'),
        lineCount,
    }
}

function convertStructuralSoftLinks(markdown: string): { readonly markdown: string; readonly count: number } {
    const lines: string[] = markdown.split('\n')
    const convertedLines: string[] = []
    let count: number = 0
    let inCodeFence: boolean = false

    for (const line of lines) {
        if (line.trimStart().startsWith('```')) {
            inCodeFence = !inCodeFence
            convertedLines.push(line)
            continue
        }

        if (inCodeFence) {
            convertedLines.push(line)
            continue
        }

        const parentLineMatch: RegExpExecArray | null = /^(\s*-\s+parent\s+)\[([^[\]]+)\](\s*)$/u.exec(line)
        if (parentLineMatch) {
            count += 1
            convertedLines.push(`${parentLineMatch[1]}[[${parentLineMatch[2].trim()}]]${parentLineMatch[3]}`)
            continue
        }

        const trimmedLine: string = line.trim()
        const standaloneSoftLinkMatch: RegExpExecArray | null = /^\[([^[\]]+)\]$/u.exec(trimmedLine)
        if (standaloneSoftLinkMatch) {
            const leadingWhitespaceLength: number = line.indexOf(trimmedLine)
            const trailingWhitespace: string = line.slice(leadingWhitespaceLength + trimmedLine.length)
            count += 1
            convertedLines.push(
                `${line.slice(0, leadingWhitespaceLength)}[[${standaloneSoftLinkMatch[1].trim()}]]${trailingWhitespace}`
            )
            continue
        }

        convertedLines.push(line)
    }

    return {
        markdown: convertedLines.join('\n'),
        count,
    }
}

function validatePreparedMarkdown(params: {
    readonly filename: string
    readonly markdown: string
    readonly maxBodyLines: number
}): readonly AuthoringRejection[] {
    const {body} = splitFrontmatter(params.markdown)
    const trimmedBody: string = body.trimEnd()
    const rejections: AuthoringRejection[] = []

    if (!/^#\s+\S/m.test(trimmedBody)) {
        rejections.push({
            code: 'missing_title',
            message: 'No `# Title` found. The first heading in the node must be a level-1 title.',
            suggestions: ['Add a `# Title` heading near the top of the node before retrying.'],
        })
    }

    const bodyLineCount: number = trimmedBody.length === 0 ? 0 : trimmedBody.split('\n').length
    if (bodyLineCount > params.maxBodyLines) {
        const suggestions: readonly string[] = suggestSplitPoints(trimmedBody)
        rejections.push({
            code: 'node_too_long',
            message: `${params.filename}: ${bodyLineCount} lines exceeds ${params.maxBodyLines}-line limit.`,
            suggestions,
        })
    }

    return rejections
}

function suggestSplitPoints(body: string): readonly string[] {
    const lines: string[] = body.split('\n')
    const sectionStarts: number[] = []

    for (const [index, line] of lines.entries()) {
        if (/^##\s+\S/.test(line)) {
            sectionStarts.push(index)
        }
    }

    if (sectionStarts.length === 0) {
        return ['Add `##` section headings to surface natural split points, then split the node by concern.']
    }

    const sectionSummaries: string[] = sectionStarts.map((start, index) => {
        const end: number = sectionStarts[index + 1] ?? lines.length
        const heading: string = lines[start].replace(/^##\s+/, '').trim()
        return `"${heading}" (${end - start} lines)`
    })

    return [`Split at ## headings: ${sectionSummaries.join(', ')}.`]
}
