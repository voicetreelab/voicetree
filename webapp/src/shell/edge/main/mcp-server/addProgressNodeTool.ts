/**
 * MCP Tool: add_progress_node
 * Creates a progress node documenting agent work in the Voicetree graph.
 * Automatically handles frontmatter (color, agent_name), parent linking,
 * file path slugification, graph positioning, and mermaid diagram validation.
 *
 * Structured sections (summary, codeDiffs, diagram, notes, linkedArtifacts)
 * are assembled into consistent markdown. Complexity score is required when
 * codeDiffs are provided.
 */

import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position} from '@/pure/graph'
import {findBestMatchingNode} from '@/pure/graph/markdown-parsing/extract-edges'
import {ensureUniqueNodeId} from '@/pure/graph/ensureUniqueNodeId'
import {parseMarkdownToGraphNode} from '@/pure/graph/markdown-parsing/parse-markdown-to-node'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getWritePath} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange'
import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {type McpToolResponse, buildJsonResponse} from './types'

export type ComplexityScore = 'low' | 'medium' | 'high'

export interface AddProgressNodeParams {
    callerTerminalId: string
    title: string
    summary: string
    content?: string
    codeDiffs?: string[]
    filesChanged?: string[]
    diagram?: string
    notes?: string[]
    linkedArtifacts?: string[]
    complexityScore?: ComplexityScore
    complexityExplanation?: string
    parentNodeId?: string
    color?: string
}

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

/**
 * Count [[wikilink]] occurrences in a string.
 */
function countWikilinksInText(text: string): number {
    const matches: RegExpMatchArray | null = text.match(/\[\[[^\]]+\]\]/g)
    return matches ? matches.length : 0
}

/**
 * Maximum allowed wikilinks per progress node.
 * Each [[wikilink]] creates a visible graph edge — too many edges turn the tree into a tangled web.
 * The parent link always uses one slot, leaving room for at most one additional link.
 */
const MAX_WIKILINKS: number = 2

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

export async function addProgressNodeTool({
    callerTerminalId,
    title,
    summary,
    content,
    codeDiffs,
    filesChanged,
    diagram,
    notes,
    linkedArtifacts,
    complexityScore,
    complexityExplanation,
    parentNodeId,
    color: colorOverride,
}: AddProgressNodeParams): Promise<McpToolResponse> {
    // Validate caller terminal exists
    const terminalRecords: TerminalRecord[] = getTerminalRecords()
    const callerRecord: TerminalRecord | undefined = terminalRecords.find(
        (record: TerminalRecord) => record.terminalId === callerTerminalId
    )
    if (!callerRecord) {
        return buildJsonResponse({
            success: false,
            error: `Unknown caller terminal: ${callerTerminalId}`
        }, true)
    }

    // Get vault path
    const vaultPathOpt: O.Option<string> = await getWritePath()
    if (O.isNone(vaultPathOpt)) {
        return buildJsonResponse({
            success: false,
            error: 'No vault loaded. Please load a folder in the UI first.'
        }, true)
    }
    const writePath: string = vaultPathOpt.value

    const graph: Graph = getGraph()

    // Resolve parent node: explicit parentNodeId, or caller's task node (anchoredToNodeId),
    // falling back to context node (attachedToContextNodeId) for terminals without a task node anchor
    const defaultParentId: string = O.isSome(callerRecord.terminalData.anchoredToNodeId)
        ? callerRecord.terminalData.anchoredToNodeId.value
        : callerRecord.terminalData.attachedToContextNodeId
    const rawParentId: string = parentNodeId ?? defaultParentId
    const resolvedParentId: NodeIdAndFilePath | undefined = graph.nodes[rawParentId]
        ? rawParentId
        : findBestMatchingNode(rawParentId, graph.nodes, graph.nodeByBaseName)

    if (!resolvedParentId || !graph.nodes[resolvedParentId]) {
        return buildJsonResponse({
            success: false,
            error: `Parent node ${rawParentId} not found.`
        }, true)
    }

    const parentNode: GraphNode = graph.nodes[resolvedParentId]

    // Validate: complexity is required when codeDiffs are provided
    const hasCodeDiffs: boolean = codeDiffs !== undefined && codeDiffs.length > 0
    if (hasCodeDiffs && (!complexityScore || !complexityExplanation)) {
        return buildJsonResponse({
            success: false,
            error: 'complexityScore and complexityExplanation are required when codeDiffs are provided.'
        }, true)
    }

    // Collect all mermaid blocks for validation: from content (inline) + diagram param
    const allMermaidBlocks: MermaidBlock[] = []
    if (content) {
        const inlineBlocks: readonly MermaidBlock[] = extractMermaidBlocks(content)
        allMermaidBlocks.push(...inlineBlocks)
    }
    if (diagram) {
        const diagramBlock: MermaidBlock = parseDiagramParam(diagram)
        // Offset index so diagram param errors are reported distinctly
        allMermaidBlocks.push({
            ...diagramBlock,
            index: allMermaidBlocks.length
        })
    }

    if (allMermaidBlocks.length > 0) {
        const validationError: string | null = await validateMermaidBlocks(allMermaidBlocks)
        if (validationError) {
            return buildJsonResponse({
                success: false,
                error: validationError
            }, true)
        }
    }

    // Validate wikilink count: parent link (1) + linkedArtifacts + inline [[...]] in content
    const parentLinkCount: number = 1
    const artifactLinkCount: number = linkedArtifacts ? linkedArtifacts.length : 0
    const inlineWikilinkCount: number = content ? countWikilinksInText(content) : 0
    const totalWikilinks: number = parentLinkCount + artifactLinkCount + inlineWikilinkCount
    if (totalWikilinks > MAX_WIKILINKS) {
        const breakdown: string[] = [`parent link (1)`]
        if (artifactLinkCount > 0) breakdown.push(`linkedArtifacts (${artifactLinkCount})`)
        if (inlineWikilinkCount > 0) breakdown.push(`inline [[wikilinks]] in content (${inlineWikilinkCount})`)
        return buildJsonResponse({
            success: false,
            error: `Too many wikilinks (${totalWikilinks}). Maximum is ${MAX_WIKILINKS}. `
                + `Breakdown: ${breakdown.join(' + ')}. `
                + `Each [[wikilink]] creates a visible graph edge — minimize links to keep the tree clean. `
                + `Move extra links to separate nodes or remove them.`
        }, true)
    }

    // Auto-generate frontmatter values from terminal record
    const agentName: string = callerRecord.terminalData.agentName
    const color: string = colorOverride ?? callerRecord.terminalData.initialEnvVars?.['AGENT_COLOR'] ?? 'blue'

    // Parent basename for wikilink (filename without extension, not full path)
    const parentBaseName: string = resolvedParentId.split('/').pop()?.replace(/\.md$/, '') ?? resolvedParentId

    // Build full markdown content from structured sections
    const markdownContent: string = buildMarkdownBody({
        title,
        summary,
        content,
        codeDiffs,
        filesChanged,
        diagram,
        notes,
        linkedArtifacts,
        complexityScore,
        complexityExplanation,
        color,
        agentName,
        parentBaseNames: [parentBaseName]
    })

    // Warnings — node is always created, but warnings are returned with isError flag.
    // For big content, use create_graph to split into multiple nodes.
    const warnings: string[] = []

    // Check summary length
    const summaryLineCount: number = summary.split('\n').length
    if (summaryLineCount > 3) {
        warnings.push(`Summary is long (${summaryLineCount} lines) — keep it to 1-3 lines. Put details in content.`)
    }

    // Check total body length, excluding codeDiffs and diagram sections from the count.
    // These sections can legitimately be large without indicating a node that needs splitting.
    let exemptLines: number = 0
    if (codeDiffs && codeDiffs.length > 0) {
        exemptLines += 2 // "## DIFF" + empty line
        for (const diff of codeDiffs) {
            exemptLines += 3 + diff.split('\n').length // ``` + diff lines + ``` + empty line
        }
    }
    if (diagram) {
        exemptLines += 5 + diagram.split('\n').length // ## Diagram + empty + ```mermaid + diagram lines + ``` + empty
    }
    const bodyLines: number = markdownContent.split('\n').length - exemptLines
    if (bodyLines > 60) {
        warnings.push(
            `⚠ NODE TOO LONG (${bodyLines} lines, limit is 60). ACTION REQUIRED: You MUST split this into multiple smaller nodes — one concept per node. Use create_graph to create a tree of nodes in a single call.\n\n`
            + `Split by concern:\n`
            + `Task\n├── Bug fix\n├── Refactor\n└── New feature\n\n`
            + `Split by phase:\n`
            + `Task\n├── Research\n├── Design\n└── Implementation`
        )
    }

    // Warn when files changed but no diffs provided
    if (filesChanged && filesChanged.length > 0 && !hasCodeDiffs) {
        warnings.push('You changed files but provided no codeDiffs — include key diffs for reviewability.')
    }

    // Warn when content is empty but summary suggests artifacts were produced
    if (!content) {
        const artifactKeywords: readonly string[] = [
            'diagram', 'mockup', 'ascii', 'wireframe', 'design', 'option',
            'proposal', 'analysis', 'table', 'architecture', 'flowchart',
            'schema', 'template', 'spec', 'plan', 'comparison', 'benchmark',
        ]
        const summaryLower: string = summary.toLowerCase()
        const matchedKeywords: readonly string[] = artifactKeywords.filter(
            (kw: string) => summaryLower.includes(kw)
        )
        if (matchedKeywords.length > 0) {
            warnings.push(
                `Summary mentions artifacts (${matchedKeywords.join(', ')}) but content is empty. `
                + `The node must be self-contained — embed all artifacts verbatim in the content field.`
            )
        }
    }

    // Warn when title/summary suggests planning/decomposition content
    const titleLower: string = title.toLowerCase()
    const summaryLowerForPlanning: string = summary.toLowerCase()
    const combinedText: string = `${titleLower} ${summaryLowerForPlanning}`
    const planningCompoundTerms: readonly string[] = [
        'planning tree', 'implementation plan', 'decomposition',
        'task tree', 'dependency graph',
    ]
    const matchedPlanningTerms: readonly string[] = planningCompoundTerms.filter(
        (term: string) => combinedText.includes(term)
    )
    const titleHasPhase: boolean = /\bphase\s+\d/i.test(title)
    if (matchedPlanningTerms.length > 0 || titleHasPhase) {
        const trigger: string = titleHasPhase
            ? `title contains "phase N" pattern`
            : `contains planning keywords (${matchedPlanningTerms.join(', ')})`
        warnings.push(
            `This looks like a planning/decomposition node (${trigger}). `
            + `For planning and task decomposition, read decompose_subtask_dependency_graph.md and subtask_template.md.`
        )
    }

    // Generate unique node ID from slugified title
    const slug: string = slugify(title)
    const candidateId: string = `${writePath}/${slug || 'progress-node'}.md`
    const existingIds: ReadonlySet<string> = new Set(Object.keys(graph.nodes))
    const nodeId: NodeIdAndFilePath = ensureUniqueNodeId(candidateId, existingIds)

    // Compute position near parent node
    const parentPosition: Position = O.getOrElse(() => ({x: 0, y: 0}))(parentNode.nodeUIMetadata.position)
    const nodePosition: Position = {
        x: parentPosition.x + 200,
        y: parentPosition.y + 100
    }

    try {
        // Parse markdown to extract edges from wikilinks and frontmatter
        const parsedNode: GraphNode = parseMarkdownToGraphNode(markdownContent, nodeId, graph)

        // Create node with computed position
        const progressNode: GraphNode = {
            absoluteFilePathIsID: nodeId,
            outgoingEdges: parsedNode.outgoingEdges,
            contentWithoutYamlOrLinks: parsedNode.contentWithoutYamlOrLinks,
            nodeUIMetadata: {
                ...parsedNode.nodeUIMetadata,
                position: O.some(nodePosition)
            }
        }

        const delta: GraphDelta = [{
            type: 'UpsertNode',
            nodeToUpsert: progressNode,
            previousNode: O.none
        }]

        await applyGraphDeltaToDBThroughMemAndUIAndEditors(delta)

        // Update caller's context node to include new progress node in containedNodeIds
        const callerContextNodeId: string = callerRecord.terminalData.attachedToContextNodeId
        const updatedGraph: Graph = getGraph()
        const callerContextNode: GraphNode | undefined = updatedGraph.nodes[callerContextNodeId]
        if (callerContextNode?.nodeUIMetadata.containedNodeIds) {
            const updatedContainedNodeIds: readonly string[] = [
                ...callerContextNode.nodeUIMetadata.containedNodeIds,
                nodeId
            ]
            const updatedContextNode: GraphNode = {
                ...callerContextNode,
                nodeUIMetadata: {
                    ...callerContextNode.nodeUIMetadata,
                    containedNodeIds: updatedContainedNodeIds
                }
            }
            const contextDelta: GraphDelta = [{
                type: 'UpsertNode',
                nodeToUpsert: updatedContextNode,
                previousNode: O.some(callerContextNode)
            }]
            await applyGraphDeltaToDBThroughMemAndUIAndEditors(contextDelta)
        }

        const hasWarnings: boolean = warnings.length > 0
        return buildJsonResponse({
            success: true,
            nodeId,
            filePath: nodeId,
            warnings
        }, hasWarnings || undefined)
    } catch (error: unknown) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: errorMessage
        }, true)
    }
}
