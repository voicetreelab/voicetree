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

type FileRecord = {
    absolutePath: string
    content: string
    order: number
}

type SummaryPreview = {
    lines: string[]
    omittedLineCount: number
}

type RenderableStructureNode = StructureNode & {
    absolutePath: string
    dirSegments: string[]
    order: number
    summaryPreview: SummaryPreview
}

type FolderGroup = {
    name: string
    order: number
    nodeIds: string[]
    subfolders: Map<string, FolderGroup>
}

const FRONTMATTER_PATTERN: RegExp = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/
const AUTO_SUMMARY_NODE_THRESHOLD: number = 30
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

    const fileRecords: readonly FileRecord[] = mdFiles.map((filePath, index) => ({
        absolutePath: filePath,
        content: readFileSync(filePath, 'utf-8'),
        order: index,
    }))
    const nodes: RenderableStructureNode[] = buildStructureNodes(fileRecords, normalizedRoot)
    const incomingCounts: Map<string, number> = countIncomingEdges(nodes)
    const orphanCount: number = nodes.filter(node => {
        const hasOutgoing: boolean = node.outgoingIds.length > 0
        const hasIncoming: boolean = (incomingCounts.get(node.id) ?? 0) > 0
        return !hasOutgoing && !hasIncoming
    }).length
    const renderSummaries: boolean = shouldRenderSummaries(nodes.length, options.withSummaries)

    return {
        success: true,
        nodeCount: nodes.length,
        ascii: renderSummaries
            ? renderContextNodeFormat(nodes)
            : renderCompactTopology(nodes, incomingCounts, {
                includeSummaryHint: options.withSummaries === undefined && nodes.length > AUTO_SUMMARY_NODE_THRESHOLD,
            }),
        orphanCount,
        folderName: path.basename(folderPath),
    }
}

function buildStructureNodes(
    files: readonly FileRecord[],
    rootPath: string
): RenderableStructureNode[] {
    const nodesById: Map<string, RenderableStructureNode> = new Map(
        files.map(({absolutePath, content, order}) => {
            const id: string = getNodeId(rootPath, absolutePath)
            const relativePath: string = path.relative(rootPath, absolutePath).replace(/\\/g, '/')
            const dir: string = path.posix.dirname(relativePath)
            return [
                id,
                {
                    id,
                    title: deriveTitle(content, absolutePath),
                    outgoingIds: [],
                    absolutePath,
                    dirSegments: dir === '.' ? [] : dir.split('/'),
                    order,
                    summaryPreview: extractSummaryPreview(content),
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

function shouldRenderSummaries(nodeCount: number, withSummaries: boolean | undefined): boolean {
    if (withSummaries === true) {
        return true
    }

    if (withSummaries === false) {
        return false
    }

    return nodeCount <= AUTO_SUMMARY_NODE_THRESHOLD
}

function extractSummaryPreview(content: string, maxLines: number = DEFAULT_SUMMARY_LINE_LIMIT): SummaryPreview {
    const lines: string[] = stripFrontmatter(content).split(/\r?\n/)
    const previewLines: string[] = []
    const remainingLines: string[] = []
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
        if (previewLines.length < maxLines) {
            previewLines.push(line)
        } else {
            remainingLines.push(line)
        }
    }

    return {
        lines: previewLines,
        omittedLineCount: remainingLines.length,
    }
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

function renderCompactTopology(
    nodes: readonly RenderableStructureNode[],
    incomingCounts: ReadonlyMap<string, number>,
    options: {
        includeSummaryHint: boolean
    }
): string {
    const nodesById: Map<string, RenderableStructureNode> = new Map(nodes.map(node => [node.id, node]))
    const visited: Set<string> = new Set()
    const lines: string[] = []
    const rootIds: string[] = nodes
        .filter(node => (incomingCounts.get(node.id) ?? 0) === 0)
        .map(node => node.id)

    const orderedRootIds: string[] = rootIds.length > 0
        ? rootIds
        : nodes.map(node => node.id)

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

        node.outgoingIds.forEach((childId, index) => {
            const isLastChild: boolean = index === node.outgoingIds.length - 1
            const childPrefix: string = isRoot
                ? ''
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

    if (options.includeSummaryHint && lines.length > 0) {
        lines.push('')
        lines.push(`${nodes.length} nodes — use --with-summaries for content`)
    }

    return lines.join('\n')
}

function renderContextNodeFormat(nodes: readonly RenderableStructureNode[]): string {
    const folderTree: FolderGroup = buildFolderTree(nodes)
    const nodesById: Map<string, RenderableStructureNode> = new Map(nodes.map(node => [node.id, node]))
    const treeLines: string[] = ['Tree structure:']
    const traversalOrder: string[] = []

    renderFolderEntries(folderTree, nodesById, treeLines, traversalOrder, '', true)

    const nodeDetailLines: string[] = traversalOrder.flatMap(nodeId => formatNodeDetails(nodesById.get(nodeId)))

    return [
        ...treeLines,
        '',
        '## Node Contents',
        ...nodeDetailLines,
    ].join('\n')
}

function buildFolderTree(nodes: readonly RenderableStructureNode[]): FolderGroup {
    const root: FolderGroup = {
        name: '',
        order: -1,
        nodeIds: [],
        subfolders: new Map(),
    }

    for (const node of nodes) {
        let current: FolderGroup = root
        for (const segment of node.dirSegments) {
            const existing: FolderGroup | undefined = current.subfolders.get(segment)
            if (existing) {
                current = existing
                continue
            }

            const nextFolder: FolderGroup = {
                name: segment,
                order: node.order,
                nodeIds: [],
                subfolders: new Map(),
            }
            current.subfolders.set(segment, nextFolder)
            current = nextFolder
        }

        current.nodeIds.push(node.id)
    }

    return root
}

function renderFolderEntries(
    folder: FolderGroup,
    nodesById: ReadonlyMap<string, RenderableStructureNode>,
    lines: string[],
    traversalOrder: string[],
    prefix: string,
    isTopLevel: boolean
): void {
    const directNodeRoots: string[] = getDisplayRootIds(folder.nodeIds, nodesById)
    const subfolders: FolderGroup[] = [...folder.subfolders.values()].sort((left, right) => {
        if (left.order !== right.order) {
            return left.order - right.order
        }
        return left.name.localeCompare(right.name)
    })
    const childEntries: Array<{kind: 'node'; id: string} | {kind: 'folder'; folder: FolderGroup}> = [
        ...directNodeRoots.map(id => ({kind: 'node' as const, id})),
        ...subfolders.map(subfolder => ({kind: 'folder' as const, folder: subfolder})),
    ]

    const directNodeSet: ReadonlySet<string> = new Set(folder.nodeIds)
    const renderedDirectNodes: Set<string> = new Set()

    childEntries.forEach((entry, index) => {
        const isLastEntry: boolean = index === childEntries.length - 1
        if (entry.kind === 'node') {
            renderLocalNodeTree(
                entry.id,
                nodesById,
                directNodeSet,
                renderedDirectNodes,
                lines,
                traversalOrder,
                prefix,
                isLastEntry,
                isTopLevel
            )
            return
        }

        renderFolderTree(
            entry.folder,
            nodesById,
            lines,
            traversalOrder,
            prefix,
            isLastEntry,
            isTopLevel
        )
    })
}

function renderFolderTree(
    folder: FolderGroup,
    nodesById: ReadonlyMap<string, RenderableStructureNode>,
    lines: string[],
    traversalOrder: string[],
    prefix: string,
    isLast: boolean,
    isTopLevel: boolean
): void {
    if (isTopLevel) {
        lines.push(`${folder.name}/`)
    } else {
        lines.push(`${prefix}${isLast ? '└── ' : '├── '}${folder.name}/`)
    }

    const childPrefix: string = isTopLevel
        ? ''
        : `${prefix}${isLast ? '    ' : '│   '}`

    renderFolderEntries(folder, nodesById, lines, traversalOrder, childPrefix, false)
}

function getDisplayRootIds(
    nodeIds: readonly string[],
    nodesById: ReadonlyMap<string, RenderableStructureNode>
): string[] {
    const directNodeSet: ReadonlySet<string> = new Set(nodeIds)
    const incomingCounts: Map<string, number> = new Map(nodeIds.map(nodeId => [nodeId, 0]))

    for (const nodeId of nodeIds) {
        const node: RenderableStructureNode | undefined = nodesById.get(nodeId)
        if (!node) {
            continue
        }

        for (const childId of node.outgoingIds) {
            if (!directNodeSet.has(childId)) {
                continue
            }
            incomingCounts.set(childId, (incomingCounts.get(childId) ?? 0) + 1)
        }
    }

    const candidateRoots: string[] = nodeIds.filter(nodeId => (incomingCounts.get(nodeId) ?? 0) === 0)
    const orderedRoots: string[] = []
    const covered: Set<string> = new Set()
    const seedRoots: readonly string[] = candidateRoots.length > 0 ? candidateRoots : nodeIds

    for (const rootId of seedRoots) {
        orderedRoots.push(rootId)
        markLocalReachable(rootId, nodesById, directNodeSet, covered)
    }

    for (const nodeId of nodeIds) {
        if (covered.has(nodeId)) {
            continue
        }
        orderedRoots.push(nodeId)
        markLocalReachable(nodeId, nodesById, directNodeSet, covered)
    }

    return orderedRoots
}

function markLocalReachable(
    nodeId: string,
    nodesById: ReadonlyMap<string, RenderableStructureNode>,
    directNodeSet: ReadonlySet<string>,
    covered: Set<string>
): void {
    if (covered.has(nodeId) || !directNodeSet.has(nodeId)) {
        return
    }

    covered.add(nodeId)
    for (const childId of getLocalChildren(nodeId, nodesById, directNodeSet)) {
        markLocalReachable(childId, nodesById, directNodeSet, covered)
    }
}

function renderLocalNodeTree(
    nodeId: string,
    nodesById: ReadonlyMap<string, RenderableStructureNode>,
    directNodeSet: ReadonlySet<string>,
    renderedDirectNodes: Set<string>,
    lines: string[],
    traversalOrder: string[],
    prefix: string,
    isLast: boolean,
    isTopLevel: boolean
): void {
    if (renderedDirectNodes.has(nodeId) || !directNodeSet.has(nodeId)) {
        return
    }

    const node: RenderableStructureNode | undefined = nodesById.get(nodeId)
    if (!node) {
        return
    }

    renderedDirectNodes.add(nodeId)
    traversalOrder.push(nodeId)

    if (isTopLevel) {
        lines.push(node.title)
    } else {
        lines.push(`${prefix}${isLast ? '└── ' : '├── '}${node.title}`)
    }

    const childIds: string[] = getLocalChildren(nodeId, nodesById, directNodeSet)
    const childPrefix: string = isTopLevel
        ? ''
        : `${prefix}${isLast ? '    ' : '│   '}`

    childIds.forEach((childId, index) => {
        renderLocalNodeTree(
            childId,
            nodesById,
            directNodeSet,
            renderedDirectNodes,
            lines,
            traversalOrder,
            childPrefix,
            index === childIds.length - 1,
            false
        )
    })
}

function getLocalChildren(
    nodeId: string,
    nodesById: ReadonlyMap<string, RenderableStructureNode>,
    directNodeSet: ReadonlySet<string>
): string[] {
    const node: RenderableStructureNode | undefined = nodesById.get(nodeId)
    if (!node) {
        return []
    }

    return node.outgoingIds
        .filter(childId => directNodeSet.has(childId))
        .sort((left, right) => {
            const leftNode: RenderableStructureNode | undefined = nodesById.get(left)
            const rightNode: RenderableStructureNode | undefined = nodesById.get(right)
            return (leftNode?.order ?? 0) - (rightNode?.order ?? 0)
        })
}

function formatNodeDetails(node: RenderableStructureNode | undefined): string[] {
    if (!node) {
        return []
    }

    const lines: string[] = [`- **${node.title}** (${node.absolutePath})`]

    for (const summaryLine of node.summaryPreview.lines) {
        lines.push(`  ${summaryLine}`)
    }

    if (node.summaryPreview.omittedLineCount > 0) {
        lines.push(`  ...${node.summaryPreview.omittedLineCount} additional lines`)
    }

    return lines
}
