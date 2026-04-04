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

export type GraphStructureResult = {
    success: true
    nodeCount: number
    ascii: string
    orphanCount: number
    folderName: string
}

export { type StructureNode } from './primitives'

export function getGraphStructure(folderPath: string): GraphStructureResult {
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
    const nodes: StructureNode[] = buildStructureNodes(fileRecords, normalizedRoot)
    const incomingCounts: Map<string, number> = countIncomingEdges(nodes)
    const orphanCount: number = nodes.filter(node => {
        const hasOutgoing: boolean = node.outgoingIds.length > 0
        const hasIncoming: boolean = (incomingCounts.get(node.id) ?? 0) > 0
        return !hasOutgoing && !hasIncoming
    }).length

    return {
        success: true,
        nodeCount: nodes.length,
        ascii: renderAscii(nodes, incomingCounts),
        orphanCount,
        folderName: path.basename(folderPath),
    }
}

function buildStructureNodes(
    files: readonly {absolutePath: string; content: string}[],
    rootPath: string
): StructureNode[] {
    const nodesById: Map<string, StructureNode> = new Map(
        files.map(({absolutePath, content}) => {
            const id: string = getNodeId(rootPath, absolutePath)
            return [id, {id, title: deriveTitle(content, absolutePath), outgoingIds: []}]
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

function countIncomingEdges(nodes: readonly StructureNode[]): Map<string, number> {
    const incomingCounts: Map<string, number> = new Map(nodes.map(node => [node.id, 0]))

    for (const node of nodes) {
        for (const targetId of node.outgoingIds) {
            incomingCounts.set(targetId, (incomingCounts.get(targetId) ?? 0) + 1)
        }
    }

    return incomingCounts
}

function renderAscii(nodes: readonly StructureNode[], incomingCounts: ReadonlyMap<string, number>): string {
    const nodesById: Map<string, StructureNode> = new Map(nodes.map(node => [node.id, node]))
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

    return lines.join('\n')
}
