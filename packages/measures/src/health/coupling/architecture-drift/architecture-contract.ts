import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'

export type ArchitectureNode = {
    readonly id: string
}

export type ArchitectureEdge = {
    readonly from: string
    readonly to: string
    readonly label: string
    readonly raw: string
}

export type DiagramSpec = {
    readonly absPath: string
    readonly nodes: readonly ArchitectureNode[]
    readonly edges: readonly ArchitectureEdge[]
    readonly clickPaths: ReadonlyMap<string, string>
    readonly refinesParentNodeId: string | null
    readonly parseErrors: readonly string[]
}

const ARCHITECTURE_FILE_NAME = 'architecture.md'

let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null

function parseRefinesFrontmatter(markdown: string): string | null {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown)
    if (!match) return null
    const refines = /^refines:\s*([A-Za-z][A-Za-z0-9_-]*)\s*$/m.exec(match[1])
    return refines?.[1] ?? null
}

function extractFlowchartBlocks(markdown: string): readonly string[] {
    const blocks: string[] = []
    const blockPattern = /```mermaid\s*\r?\n([\s\S]*?)```/g
    for (const match of markdown.matchAll(blockPattern)) {
        const body = match[1].trim()
        if (/^flowchart\b/m.test(body)) blocks.push(body)
    }
    return blocks
}

function stripComment(line: string): string {
    const commentIndex = line.indexOf('%%')
    return (commentIndex === -1 ? line : line.slice(0, commentIndex)).trim().replace(/;$/, '').trim()
}

function parseNodeId(token: string): string | null {
    const trimmed = token.trim()
    const match = /^([A-Za-z][A-Za-z0-9_-]*)/.exec(trimmed)
    return match?.[1] ?? null
}

function hasNodeShape(token: string): boolean {
    return /^[A-Za-z][A-Za-z0-9_-]*\s*(?:\[|\(|\{|\(\(|\[\[|\{\{)/.test(token.trim())
}

function parseClick(line: string): readonly [string, string] | null {
    const match = /^click\s+([A-Za-z][A-Za-z0-9_-]*)\s+"([^"]+)"(?:\s|$)/.exec(line)
    return match ? [match[1], match[2]] : null
}

function parseEdge(line: string): ArchitectureEdge | null {
    const match = /^(.+?)\s+-->\s*(.+)$/.exec(line)
    if (!match) return null
    const from = parseNodeId(match[1])
    if (!from) return null

    const afterArrow = match[2].trim()
    const labeledTarget = /^\|([^|]*)\|\s*(.+)$/.exec(afterArrow)
    const label = labeledTarget ? labeledTarget[1].trim() : ''
    const targetToken = labeledTarget ? labeledTarget[2] : afterArrow
    const to = parseNodeId(targetToken)
    if (!to) return null

    return {from, to, label, raw: line}
}

function parseNodeDeclaration(line: string): string | null {
    if (!hasNodeShape(line)) return null
    return parseNodeId(line)
}

function collectNodeIds(
    explicitNodeIds: readonly string[],
    edges: readonly ArchitectureEdge[],
    clickPaths: ReadonlyMap<string, string>,
): readonly ArchitectureNode[] {
    const nodeIds = new Set<string>()
    for (const id of explicitNodeIds) nodeIds.add(id)
    for (const edge of edges) {
        nodeIds.add(edge.from)
        nodeIds.add(edge.to)
    }
    for (const id of clickPaths.keys()) nodeIds.add(id)
    return [...nodeIds].sort((a, b) => a.localeCompare(b)).map(id => ({id}))
}

function parseFlowchartContract(flowchart: string): Omit<DiagramSpec, 'absPath' | 'refinesParentNodeId'> {
    const explicitNodeIds: string[] = []
    const duplicateNodeIds: string[] = []
    const seenExplicitNodes = new Set<string>()
    const edges: ArchitectureEdge[] = []
    const clickEntries = new Map<string, string>()
    const duplicateClickIds: string[] = []

    for (const rawLine of flowchart.split(/\r?\n/)) {
        const line = stripComment(rawLine)
        if (line === '' || /^flowchart\b/.test(line)) continue
        if (/^(subgraph|end|classDef|class|style|linkStyle)\b/.test(line)) continue

        const click = parseClick(line)
        if (click) {
            const [id, path] = click
            if (clickEntries.has(id)) duplicateClickIds.push(id)
            clickEntries.set(id, path)
            continue
        }

        const edge = parseEdge(line)
        if (edge) {
            edges.push(edge)
            continue
        }

        const nodeId = parseNodeDeclaration(line)
        if (nodeId) {
            if (seenExplicitNodes.has(nodeId)) duplicateNodeIds.push(nodeId)
            seenExplicitNodes.add(nodeId)
            explicitNodeIds.push(nodeId)
        }
    }

    const parseErrors = [
        ...duplicateNodeIds.map(id =>
            `Node id '${id}' is declared more than once in the Mermaid flowchart. Reconcile the diagram so each node has one declaration.`,
        ),
        ...duplicateClickIds.map(id =>
            `Node id '${id}' has more than one click directive. Reconcile the diagram so the node binds to exactly one code path.`,
        ),
    ]

    return {
        nodes: collectNodeIds(explicitNodeIds, edges, clickEntries),
        edges,
        clickPaths: clickEntries,
        parseErrors,
    }
}

async function assertMermaidSyntax(flowchart: string, absPath: string): Promise<readonly string[]> {
    const globalWithWindow = globalThis as typeof globalThis & {window?: unknown}
    if (!globalWithWindow.window) {
        globalWithWindow.window = new JSDOM('').window
    }
    mermaidModulePromise ??= import('mermaid')
    const mermaid = (await mermaidModulePromise).default
    mermaid.initialize({startOnLoad: false})
    try {
        await mermaid.parse(flowchart, {suppressErrors: false})
        return []
    } catch (cause) {
        return [
            `File ${absPath} contains Mermaid syntax that the official parser rejected: ${(cause as Error).message}. Reconcile the diagram syntax before changing code.`,
        ]
    }
}

export async function parseArchitectureMd(absPath: string): Promise<DiagramSpec> {
    const markdown = await readFile(absPath, 'utf8')
    const blocks = extractFlowchartBlocks(markdown)
    if (blocks.length !== 1) {
        return {
            absPath,
            nodes: [],
            edges: [],
            clickPaths: new Map(),
            refinesParentNodeId: parseRefinesFrontmatter(markdown),
            parseErrors: [
                `File ${absPath} contains ${blocks.length} Mermaid flowchart blocks; ${ARCHITECTURE_FILE_NAME} must contain exactly one. Reconcile the diagram file.`,
            ],
        }
    }

    const contract = parseFlowchartContract(blocks[0])
    return {
        absPath,
        ...contract,
        refinesParentNodeId: parseRefinesFrontmatter(markdown),
        parseErrors: [
            ...await assertMermaidSyntax(blocks[0], absPath),
            ...contract.parseErrors,
        ],
    }
}
