/**
 * Shared utilities for progress node creation.
 * Used by createGraphTool.ts for markdown body assembly, mermaid validation,
 * slug generation, and body length counting.
 */

export type ComplexityScore = 'low' | 'medium' | 'high'

/**
 * Mapping from mermaid diagram type declarations (first line of block)
 * to the parser's supported diagram type names.
 * Types not in this map are unsupported by @mermaid-js/parser — skip validation.
 */
const MERMAID_TYPE_TO_PARSER_TYPE: ReadonlyMap<string, string> = new Map([
    ['pie', 'pie'],
    ['gitGraph', 'gitGraph'],
    ['info', 'info'],
    ['packet-beta', 'packet'],
    ['architecture-beta', 'architecture'],
    ['radar-beta', 'radar'],
    ['treemap', 'treemap'],
])

export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
}

export type MermaidBlock = {
    readonly index: number
    readonly diagramType: string | undefined
    readonly parserType: string | undefined
    readonly textWithoutFirstLine: string
}

export function extractMermaidBlocks(content: string): readonly MermaidBlock[] {
    const regex: RegExp = /```mermaid\n([\s\S]*?)```/g
    const blocks: MermaidBlock[] = []
    let match: RegExpExecArray | null = regex.exec(content)
    let index: number = 0
    while (match !== null) {
        const blockContent: string = match[1]
        const lines: string[] = blockContent.split('\n')
        const firstLine: string = (lines[0] ?? '').trim()
        const diagramType: string | undefined = firstLine.split(/\s+/)[0]
        const parserType: string | undefined = diagramType
            ? MERMAID_TYPE_TO_PARSER_TYPE.get(diagramType)
            : undefined
        const textWithoutFirstLine: string = lines.slice(1).join('\n')
        blocks.push({index, diagramType, parserType, textWithoutFirstLine})
        index++
        match = regex.exec(content)
    }
    return blocks
}

/**
 * Parse the diagram parameter to extract its type declaration from the first line.
 * Returns a MermaidBlock for validation.
 */
export function parseDiagramParam(diagramSource: string): MermaidBlock {
    const lines: string[] = diagramSource.split('\n')
    const firstLine: string = (lines[0] ?? '').trim()
    const diagramType: string | undefined = firstLine.split(/\s+/)[0]
    const parserType: string | undefined = diagramType
        ? MERMAID_TYPE_TO_PARSER_TYPE.get(diagramType)
        : undefined
    const textWithoutFirstLine: string = lines.slice(1).join('\n')
    return {index: 0, diagramType, parserType, textWithoutFirstLine}
}

/**
 * Validate mermaid blocks using @mermaid-js/parser (ESM-only, dynamic import).
 * Only validates diagram types the parser supports; unsupported types pass through.
 * Returns error message string on failure, null on success.
 */
export async function validateMermaidBlocks(blocks: readonly MermaidBlock[]): Promise<string | null> {
    const validatableBlocks: readonly MermaidBlock[] = blocks.filter(
        (b: MermaidBlock) => b.parserType !== undefined
    )
    if (validatableBlocks.length === 0) return null

    try {
        // Dynamic import — @mermaid-js/parser is ESM-only
        const mermaidParser: {parse: (diagramType: string, text: string) => Promise<unknown>} =
            await import('@mermaid-js/parser') as {parse: (diagramType: string, text: string) => Promise<unknown>}

        for (const block of validatableBlocks) {
            try {
                await mermaidParser.parse(block.parserType!, block.textWithoutFirstLine)
            } catch (error: unknown) {
                const errorMessage: string = error instanceof Error ? error.message : String(error)
                return `Mermaid diagram error in block ${block.index + 1} (${block.diagramType}): ${errorMessage}`
            }
        }
    } catch (_importError: unknown) {
        // If we can't import the parser, skip validation silently
        return null
    }

    return null
}

/**
 * Build the markdown body from structured sections.
 * Sections are assembled in a consistent order below the title.
 */
export function buildMarkdownBody(params: {
    readonly title: string
    readonly summary: string
    readonly content: string | undefined
    readonly codeDiffs: readonly string[] | undefined
    readonly filesChanged: readonly string[] | undefined
    readonly diagram: string | undefined
    readonly notes: readonly string[] | undefined
    readonly linkedArtifacts: readonly string[] | undefined
    readonly complexityScore: ComplexityScore | undefined
    readonly complexityExplanation: string | undefined
    readonly color: string
    readonly agentName: string
    readonly parentBaseNames: readonly string[]
}): string {
    const sections: string[] = []

    // Frontmatter
    sections.push('---')
    sections.push(`color: ${params.color}`)
    sections.push(`agent_name: ${params.agentName}`)
    sections.push('---')
    sections.push('')

    // Title
    sections.push(`# ${params.title}`)
    sections.push('')

    // Summary (always first after title)
    sections.push(params.summary)
    sections.push('')

    // Content (optional freeform body)
    if (params.content) {
        sections.push(params.content)
        sections.push('')
    }

    // Code Diffs
    if (params.codeDiffs && params.codeDiffs.length > 0) {
        sections.push('## DIFF')
        sections.push('')
        for (const diff of params.codeDiffs) {
            sections.push('```')
            sections.push(diff)
            sections.push('```')
            sections.push('')
        }
    }

    // Complexity (rendered when codeDiffs are present)
    if (params.complexityScore && params.complexityExplanation) {
        sections.push(`## Complexity: ${params.complexityScore}`)
        sections.push('')
        sections.push(params.complexityExplanation)
        sections.push('')
    }

    // Files Changed
    if (params.filesChanged && params.filesChanged.length > 0) {
        sections.push('## Files Changed')
        sections.push('')
        for (const f of params.filesChanged) {
            sections.push(`- ${f}`)
        }
        sections.push('')
    }

    // Diagram
    if (params.diagram) {
        sections.push('## Diagram')
        sections.push('')
        sections.push('```mermaid')
        sections.push(params.diagram)
        sections.push('```')
        sections.push('')
    }

    // Notes
    if (params.notes && params.notes.length > 0) {
        sections.push('### NOTES')
        sections.push('')
        for (const note of params.notes) {
            sections.push(`- ${note}`)
        }
        sections.push('')
    }

    // Linked Artifacts
    if (params.linkedArtifacts && params.linkedArtifacts.length > 0) {
        sections.push('## Related')
        sections.push('')
        for (const artifact of params.linkedArtifacts) {
            sections.push(`[[${artifact}]]`)
        }
        sections.push('')
    }

    // Parent wikilinks
    for (const parentBaseName of params.parentBaseNames) {
        sections.push(`Progress on [[${parentBaseName}]]`)
    }
    sections.push('')

    return sections.join('\n')
}

/**
 * Count body lines using an allowlist approach: only summary + content count.
 * Everything else (frontmatter, title, codeDiffs, diagram, filesChanged, notes,
 * linkedArtifacts, parent wikilinks) is auto-excluded.
 */
export function countBodyLines(summary: string, content: string | undefined): number {
    const summaryLines: number = summary.split('\n').length
    const contentLines: number = content ? content.split('\n').length : 0
    return summaryLines + contentLines
}
