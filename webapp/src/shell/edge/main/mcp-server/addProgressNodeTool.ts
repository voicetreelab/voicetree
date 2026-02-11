/**
 * MCP Tool: add_progress_node
 * Creates a progress node documenting agent work in the Voicetree graph.
 * Automatically handles frontmatter (color, agent_name), parent linking,
 * file path slugification, graph positioning, and mermaid diagram validation.
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

export interface AddProgressNodeParams {
    callerTerminalId: string
    title: string
    content: string
    filesChanged?: string[]
    parentNodeId?: string
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

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
}

type MermaidBlock = {
    readonly index: number
    readonly diagramType: string | undefined
    readonly parserType: string | undefined
    readonly textWithoutFirstLine: string
}

function extractMermaidBlocks(content: string): readonly MermaidBlock[] {
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
 * Validate mermaid blocks using @mermaid-js/parser (ESM-only, dynamic import).
 * Only validates diagram types the parser supports; unsupported types pass through.
 * Returns error message string on failure, null on success.
 */
async function validateMermaidBlocks(blocks: readonly MermaidBlock[]): Promise<string | null> {
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

export async function addProgressNodeTool({
    callerTerminalId,
    title,
    content,
    filesChanged,
    parentNodeId
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

    // Resolve parent node: explicit parentNodeId or caller's attached task node
    const rawParentId: string = parentNodeId ?? callerRecord.terminalData.attachedToNodeId
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

    // Validate mermaid blocks before creating node
    const mermaidBlocks: readonly MermaidBlock[] = extractMermaidBlocks(content)
    if (mermaidBlocks.length > 0) {
        const validationError: string | null = await validateMermaidBlocks(mermaidBlocks)
        if (validationError) {
            return buildJsonResponse({
                success: false,
                error: validationError
            }, true)
        }
    }

    // Auto-generate frontmatter values from terminal record
    const agentName: string = callerRecord.terminalData.agentName
    const color: string = callerRecord.terminalData.initialEnvVars?.['AGENT_COLOR'] ?? 'blue'

    // Parent basename for wikilink (filename without extension, not full path)
    const parentBaseName: string = resolvedParentId.split('/').pop()?.replace(/\.md$/, '') ?? resolvedParentId

    // Build files changed section
    const filesChangedSection: string = filesChanged && filesChanged.length > 0
        ? `\n## Files Changed\n${filesChanged.map((f: string) => `- ${f}`).join('\n')}\n`
        : ''

    // Build full markdown content
    const markdownContent: string = [
        '---',
        `color: ${color}`,
        `agent_name: ${agentName}`,
        '---',
        '',
        `# ${title}`,
        '',
        content,
        filesChangedSection,
        `Progress on [[${parentBaseName}]]`,
        ''
    ].join('\n')

    // Check content length warning
    const warnings: string[] = []
    const contentLineCount: number = content.split('\n').length
    if (contentLineCount > 60) {
        warnings.push(`Content is long (${contentLineCount} lines) — consider splitting into multiple nodes`)
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
        const callerContextNodeId: string = callerRecord.terminalData.attachedToNodeId
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

        return buildJsonResponse({
            success: true,
            nodeId,
            filePath: nodeId,
            warnings
        })
    } catch (error: unknown) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: errorMessage
        }, true)
    }
}
