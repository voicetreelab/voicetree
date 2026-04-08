/**
 * Shared utilities for progress node creation.
 * Used by createGraphTool.ts for markdown body assembly, mermaid validation,
 * slug generation, and body length counting.
 */

import {
    buildMarkdownBody as buildGraphToolsMarkdownBody,
    type BuildMarkdownBodyParams,
    type ComplexityScore,
} from '../../../../../../packages/graph-tools/src/filesystemAuthoring.ts'

export type {BuildMarkdownBodyParams, ComplexityScore}

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
export function buildMarkdownBody(params: BuildMarkdownBodyParams): string {
    return buildGraphToolsMarkdownBody(params)
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
