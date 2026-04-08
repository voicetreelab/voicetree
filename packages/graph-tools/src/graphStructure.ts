import { readFileSync } from 'fs'
import path from 'path'
import {
    scanMarkdownFiles,
    getNodeId,
    deriveTitle,
    extractLinks,
    buildUniqueBasenameMap,
    resolveLinkTarget,
    type StructureNode,
} from './primitives'

export type GraphStructureOptions = {
    withSummaries?: boolean
}

export type GraphStructureResult = {
    success: true
    nodeCount: number
    ascii: string
    orphanCount: number
    folderName: string
}

export { type StructureNode } from './primitives'

type RenderableStructureNode = StructureNode & {
    summaryLines: string[]
}

const FRONTMATTER_PATTERN: RegExp = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/
const DEFAULT_SUMMARY_LINE_LIMIT: number = 3

export function getGraphStructure(folderPath: string, options: GraphStructureOptions = {}): GraphStructureResult {
    const mdFiles: readonly string[] = scanMarkdownFiles(folderPath)
    const normalizedRoot: string = path.resolve(folderPath)

    if (mdFiles.length === 0) {
        return {
            success: true,
            nodeCount: 0,
            ascii: '',
            orphanCount: 0,
            folderName: path.basename(folderPath),
        }
    }

    const fileRecords: readonly {absolutePath: string; content: string}[] = mdFiles.map(filePath => ({
        absolutePath: filePath,
        content: readFileSync(filePath, 'utf-8')
    }))
    const nodes: RenderableStructureNode[] = buildStructureNodes(fileRecords, normalizedRoot)
    const incomingCounts: Map<string, number> = countIncomingEdges(nodes)
    const orphanCount: number = nodes.filter(node => {
        const hasOutgoing: boolean = node.outgoingIds.length > 0
        const hasIncoming: boolean = (incomingCounts.get(node.id) ?? 0) > 0
        return !hasOutgoing && !hasIncoming
    }).length

    return {
        success: true,
        nodeCount: nodes.length,
        ascii: renderAscii(nodes, incomingCounts, options),
        orphanCount,
        folderName: path.basename(folderPath),
    }
}

function buildStructureNodes(
    files: readonly {absolutePath: string; content: string}[],
    rootPath: string
): RenderableStructureNode[] {
    const nodesById: Map<string, RenderableStructureNode> = new Map(
        files.map(({absolutePath, content}) => {
            const id: string = getNodeId(rootPath, absolutePath)
            return [
                id,
                {
                    id,
                    title: deriveTitle(content, absolutePath),
                    outgoingIds: [],
                    summaryLines: extractSummaryLines(content),
                }
            ]
        })
    )
    const uniqueBasenames: Map<string, string> = buildUniqueBasenameMap(nodesById)

    for (const {absolutePath, content} of files) {
        const currentId: string = getNodeId(rootPath, absolutePath)
        const node: StructureNode | undefined = nodesById.get(currentId)
        if (!node) {
            continue
        }

        const outgoingIds: string[] = extractLinks(content)
            .map(link => resolveLinkTarget(link, currentId, nodesById, uniqueBasenames))
            .filter((targetId: string | undefined): targetId is string => targetId !== undefined)

        node.outgoingIds = [...new Set(outgoingIds)]
    }

    return [...nodesById.values()]
}

function stripFrontmatter(content: string): string {
    return content.replace(FRONTMATTER_PATTERN, '')
}

function isSummaryScaffoldingLine(line: string): boolean {
    return /^(#{1,6}\s+|```|---$)/.test(line)
}

function extractSummaryLines(content: string, maxLines: number = DEFAULT_SUMMARY_LINE_LIMIT): string[] {
    const lines: string[] = stripFrontmatter(content).split(/\r?\n/)
    const summaryLines: string[] = []
    let titleLineHandled: boolean = false

    for (const rawLine of lines) {
        const line: string = rawLine.trim()
        if (line.length === 0) {
            continue
        }

        if (!titleLineHandled && /^#\s+/.test(line)) {
            titleLineHandled = true
            continue
        }

        titleLineHandled = true
        if (isSummaryScaffoldingLine(line)) {
            continue
        }

        summaryLines.push(line)

        if (summaryLines.length >= maxLines) {
            break
        }
    }

    return summaryLines
}

function countIncomingEdges(nodes: readonly Pick<StructureNode, 'id' | 'outgoingIds'>[]): Map<string, number> {
    const incomingCounts: Map<string, number> = new Map(nodes.map(node => [node.id, 0]))

    for (const node of nodes) {
        for (const targetId of node.outgoingIds) {
            incomingCounts.set(targetId, (incomingCounts.get(targetId) ?? 0) + 1)
        }
    }

    return incomingCounts
}

function renderAscii(
    nodes: readonly RenderableStructureNode[],
    incomingCounts: ReadonlyMap<string, number>,
    options: GraphStructureOptions
): string {
    const nodesById: Map<string, RenderableStructureNode> = new Map(nodes.map(node => [node.id, node]))
    const visited: Set<string> = new Set()
    const lines: string[] = []
    const withSummaries: boolean = options.withSummaries === true
    const rootIds: string[] = nodes
        .filter(node => (incomingCounts.get(node.id) ?? 0) === 0)
        .map(node => node.id)

    const orderedRootIds: string[] = rootIds.length > 0
        ? rootIds
        : nodes.map(node => node.id)

    function appendSummaryLines(node: RenderableStructureNode, prefix: string, isLast: boolean, isRoot: boolean): void {
        if (!withSummaries || node.summaryLines.length === 0) {
            return
        }

        const summaryPrefix: string = isRoot
            ? '  '
            : `${prefix}${isLast ? '    ' : '│   '}`

        for (const summaryLine of node.summaryLines) {
            lines.push(`${summaryPrefix}> ${summaryLine}`)
        }
    }

    function printTree(nodeId: string, prefix: string, isLast: boolean, isRoot: boolean): void {
        if (visited.has(nodeId)) {
            return
        }

        visited.add(nodeId)
        const node: StructureNode | undefined = nodesById.get(nodeId)
        if (!node) {
            return
        }

        if (isRoot) {
            lines.push(node.title)
        } else {
            lines.push(`${prefix}${isLast ? '└── ' : '├── '}${node.title}`)
        }

        appendSummaryLines(node, prefix, isLast, isRoot)

        node.outgoingIds.forEach((childId, index) => {
            const isLastChild: boolean = index === node.outgoingIds.length - 1
            const childPrefix: string = isRoot
                ? (withSummaries ? '  ' : '')
                : `${prefix}${isLast ? '    ' : '│   '}`
            printTree(childId, childPrefix, isLastChild, false)
        })
    }

    orderedRootIds.forEach((rootId, index) => {
        if (index > 0 && lines.length > 0) {
            lines.push('')
        }
        printTree(rootId, '', true, true)
    })

    return lines.join('\n')
}
