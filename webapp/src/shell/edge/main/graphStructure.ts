import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

export type GraphStructureResult = {
    success: true
    nodeCount: number
    ascii: string
    orphanCount: number
    folderName: string
}

type StructureNode = {
    id: string
    title: string
    outgoingIds: string[]
}

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

function scanMarkdownFiles(dirPath: string): readonly string[] {
    const results: string[] = []

    function walk(dir: string): void {
        const entries: string[] = readdirSync(dir).sort((left, right) => left.localeCompare(right))
        for (const entry of entries) {
            if (entry === 'ctx-nodes') continue
            if (entry.startsWith('.')) continue

            const fullPath: string = path.join(dir, entry)
            const stat: ReturnType<typeof statSync> = statSync(fullPath)
            if (stat.isDirectory()) {
                walk(fullPath)
            } else if (entry.endsWith('.md')) {
                results.push(fullPath)
            }
        }
    }

    walk(dirPath)
    return results
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

function getNodeId(rootPath: string, absolutePath: string): string {
    const relativePath: string = path.relative(rootPath, absolutePath).replace(/\\/g, '/')
    return relativePath.replace(/\.md$/i, '')
}

function deriveTitle(content: string, absolutePath: string): string {
    const contentWithoutFrontmatter: string = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
    const headingMatch: RegExpMatchArray | null = contentWithoutFrontmatter.match(/^#\s+(.+)$/m)
    if (headingMatch?.[1]) {
        return headingMatch[1].trim()
    }

    const firstNonEmptyLine: string | undefined = contentWithoutFrontmatter
        .split('\n')
        .map(line => line.trim())
        .find(line => line.length > 0)

    if (firstNonEmptyLine) {
        return firstNonEmptyLine
    }

    return path.basename(absolutePath, '.md')
}

function extractLinks(content: string): string[] {
    const links: string[] = []
    const wikilinkRegex: RegExp = /\[\[([^[\]]+)\]\]/g

    for (const match of content.matchAll(wikilinkRegex)) {
        const rawLink: string | undefined = match[1]
        if (rawLink) {
            links.push(rawLink)
        }
    }

    return links
}

function buildUniqueBasenameMap(nodesById: ReadonlyMap<string, StructureNode>): Map<string, string> {
    const idsByBasename: Map<string, string[]> = new Map()

    for (const nodeId of nodesById.keys()) {
        const basename: string = path.posix.basename(nodeId)
        const ids: string[] = idsByBasename.get(basename) ?? []
        ids.push(nodeId)
        idsByBasename.set(basename, ids)
    }

    const uniqueBasenames: Map<string, string> = new Map()
    for (const [basename, ids] of idsByBasename.entries()) {
        if (ids.length === 1) {
            uniqueBasenames.set(basename, ids[0])
        }
    }

    return uniqueBasenames
}

function resolveLinkTarget(
    rawLink: string,
    currentId: string,
    nodesById: ReadonlyMap<string, StructureNode>,
    uniqueBasenames: ReadonlyMap<string, string>
): string | undefined {
    const linkTarget: string = rawLink.split('|')[0]?.split('#')[0]?.trim() ?? ''
    if (!linkTarget) {
        return undefined
    }

    const normalizedTarget: string = linkTarget.replace(/\\/g, '/').replace(/\.md$/i, '')
    const currentDir: string = path.posix.dirname(currentId)
    const exactCandidates: string[] = [
        path.posix.normalize(normalizedTarget),
        path.posix.normalize(path.posix.join(currentDir, normalizedTarget)),
    ]

    for (const candidate of exactCandidates) {
        if (nodesById.has(candidate)) {
            return candidate
        }
    }

    if (!normalizedTarget.includes('/')) {
        return uniqueBasenames.get(path.posix.basename(normalizedTarget))
    }

    return undefined
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
