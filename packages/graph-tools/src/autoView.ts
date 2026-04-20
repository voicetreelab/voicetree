import * as fs from 'node:fs'
import * as path from 'node:path'
import {
    scanMarkdownFiles,
    getNodeId,
    extractLinks,
    buildUniqueBasenameMap,
    resolveLinkTarget,
    type StructureNode,
} from './primitives'
import {
    countVisibleEntities,
    findCollapseBoundary,
    type CollapseBoundaryGraph,
    type CollapseBoundaryNode,
    type CollapseCluster,
} from './collapseBoundary'

const DEFAULT_BUDGET = 30
import {
    computeArboricity,
    deriveTitle,
    relId,
    type DirectedEdge,
    type JsonState,
} from '../scripts/L3-BF-192-tree-cover-render'

export interface AutoViewOptions {
    readonly budget?: number
    readonly selectedIds?: readonly string[]
    readonly focusNodeId?: string
}

interface AutoViewNode extends CollapseBoundaryNode {
    readonly basename: string
}

interface AutoViewGraph extends CollapseBoundaryGraph {
    readonly rootPath: string
    readonly nodes: readonly AutoViewNode[]
    readonly nodeById: ReadonlyMap<string, AutoViewNode>
    readonly edges: readonly DirectedEdge[]
    readonly forests: readonly (readonly DirectedEdge[])[]
    readonly arboricity: number
}

type SpineEntry =
    | {readonly kind: 'folder'; readonly folderPath: string; readonly sortKey: string}
    | {readonly kind: 'summary'; readonly cluster: CollapseCluster; readonly sortKey: string}
    | {readonly kind: 'file'; readonly node: AutoViewNode; readonly sortKey: string}

function buildJsonStateFromVault(root: string): JsonState {
    const mdFiles = scanMarkdownFiles(root)
    const structureNodes = new Map<string, StructureNode>()
    const contentMap = new Map<string, string>()
    for (const absPath of mdFiles) {
        const id = getNodeId(root, absPath)
        const content = fs.readFileSync(absPath, 'utf-8')
        structureNodes.set(id, {id, title: id, outgoingIds: []})
        contentMap.set(id, content)
    }
    const uniqueBasenames = buildUniqueBasenameMap(structureNodes)
    const nodes: JsonState['graph']['nodes'] = {}
    for (const [id, content] of contentMap) {
        const absPath = path.join(root, id + '.md')
        const outgoingEdges: {targetId: string}[] = []
        for (const link of extractLinks(content)) {
            const target = resolveLinkTarget(link, id, structureNodes, uniqueBasenames)
            if (target && target !== id) {
                outgoingEdges.push({targetId: path.join(root, target + '.md')})
            }
        }
        nodes[absPath] = {absoluteFilePathIsID: absPath, contentWithoutYamlOrLinks: content, outgoingEdges}
    }
    return {graph: {nodes}}
}

function buildAutoViewGraph(root: string): AutoViewGraph {
    const state = buildJsonStateFromVault(root)
    const nodes: AutoViewNode[] = []
    const nodeById = new Map<string, AutoViewNode>()
    const edges: DirectedEdge[] = []

    for (const [id, node] of Object.entries(state.graph.nodes)) {
        const relPath: string = relId(id, root)
        const basename: string = path.posix.basename(relPath)
        const folderPathRaw: string = path.posix.dirname(relPath)
        const folderPath: string = folderPathRaw === '.' ? '' : folderPathRaw
        const title: string = deriveTitle(node.contentWithoutYamlOrLinks, path.basename(id, '.md'))
        const outgoingIds: readonly string[] = node.outgoingEdges
            .map(edge => edge.targetId)
            .filter(targetId => targetId !== id)
        const autoNode: AutoViewNode = {id, title, relPath, folderPath, outgoingIds, basename}
        nodes.push(autoNode)
        nodeById.set(id, autoNode)
        outgoingIds.forEach(targetId => edges.push({src: id, tgt: targetId}))
    }

    const cover = computeArboricity(nodes.length, edges)
    return {
        rootPath: root,
        rootName: path.basename(root),
        nodes,
        nodeById,
        edges,
        forests: cover.forests,
        arboricity: cover.arboricityUpperBound,
    }
}

export function renderAutoView(
    vaultPath: string,
    options: AutoViewOptions = {},
): {output: string; format: string} {
    const root: string = path.resolve(vaultPath)
    const graph: AutoViewGraph = buildAutoViewGraph(root)
    if (graph.nodes.length === 0) {
        return {output: '', format: 'tree-cover'}
    }

    const budget: number = Math.max(1, Math.trunc(options.budget ?? DEFAULT_BUDGET))
    const collapseGraph: CollapseBoundaryGraph = {rootName: graph.rootName, nodes: graph.nodes}
    const clusters: readonly CollapseCluster[] = findCollapseBoundary(collapseGraph, budget, {
        selectedIds: options.selectedIds,
        focusNodeId: options.focusNodeId,
    })
    const visibleEntityCount: number = countVisibleEntities(graph.nodes.length, clusters)
    const body: string = renderTreeCoverBody(graph, clusters)
    const header: string = buildAutoHeader(graph, clusters, budget, visibleEntityCount)
    const footer: string = buildAutoFooter(clusters)

    return {output: footer.length > 0 ? `${header}\n${body}\n${footer}` : `${header}\n${body}`, format: 'tree-cover'}
}

function buildAutoHeader(
    graph: AutoViewGraph,
    clusters: readonly CollapseCluster[],
    budget: number,
    visibleEntityCount: number,
): string {
    const collapsedNodeCount: number = clusters.reduce((sum, cluster) => sum + cluster.nodeIds.length, 0)
    const visibleNodeCount: number = graph.nodes.length - collapsedNodeCount
    const strategy: string = clusters[0]?.strategy ?? 'none'
    const lines: string[] = [
        '# format: tree-cover (auto-selected)',
        `# graph: N=${graph.nodes.length} E=${graph.edges.length} a(G)=${graph.arboricity} forests=${graph.forests.length}`,
        `# budget: ${budget} visible entities (expanded nodes + cluster summaries)`,
        clusters.length === 0
            ? `# collapse: none (visible=${visibleEntityCount} <= budget=${budget})`
            : `# collapse: strategy=${strategy} visible=${visibleEntityCount} visibleNodes=${visibleNodeCount} collapsedNodes=${collapsedNodeCount} clusters=${clusters.length}`,
    ]

    for (const cluster of clusters) {
        lines.push(
            `# cluster: ${formatCollapsedSummary(cluster)} cohesion=${cluster.cohesion.toFixed(2)} reason=${cluster.strategy}`,
        )
    }

    return lines.join('\n')
}

function buildAutoFooter(clusters: readonly CollapseCluster[]): string {
    if (clusters.length === 0) return ''
    return [
        '',
        '# hint: to expand a collapsed ▢ cluster, run the `expand:` command printed beside it',
        '#       (requires a live vt-graph server; alternatively raise --budget=N to see more)',
    ].join('\n')
}

function renderTreeCoverBody(graph: AutoViewGraph, clusters: readonly CollapseCluster[]): string {
    const spine: string = renderSpine(graph, clusters)
    const forests: readonly string[] = renderForests(graph, clusters)
    return [
        '═══ SPINE (folder hierarchy, no content edges) ═══',
        spine,
        '',
        ...forests.flatMap(section => [section, '']),
    ].join('\n')
}

function renderSpine(graph: AutoViewGraph, clusters: readonly CollapseCluster[]): string {
    const clusterByNodeId: ReadonlyMap<string, CollapseCluster> = buildClusterByNodeId(clusters)
    const visibleFilesByFolder = new Map<string, AutoViewNode[]>()
    const summariesByAnchor = new Map<string, CollapseCluster[]>()
    const requiredFolders = new Set<string>()

    for (const node of graph.nodes) {
        if (clusterByNodeId.has(node.id)) continue
        const files: AutoViewNode[] = visibleFilesByFolder.get(node.folderPath) ?? []
        files.push(node)
        visibleFilesByFolder.set(node.folderPath, files)
        ancestorFolders(node.folderPath).forEach(folderPath => requiredFolders.add(folderPath))
    }

    for (const cluster of clusters) {
        const summaries: CollapseCluster[] = summariesByAnchor.get(cluster.anchorFolderPath) ?? []
        summaries.push(cluster)
        summariesByAnchor.set(cluster.anchorFolderPath, summaries)
        ancestorFolders(cluster.anchorFolderPath).forEach(folderPath => requiredFolders.add(folderPath))
    }

    const childFoldersByParent = new Map<string, string[]>()
    for (const folderPath of requiredFolders) {
        const parentFolder: string = parentFolderPath(folderPath)
        const folders: string[] = childFoldersByParent.get(parentFolder) ?? []
        folders.push(folderPath)
        childFoldersByParent.set(parentFolder, folders)
    }

    const lines: string[] = [`▢ ${graph.rootName}/`]
    renderFolderEntries('', '', false, lines, childFoldersByParent, visibleFilesByFolder, summariesByAnchor)
    return lines.join('\n')
}

function renderFolderEntries(
    folderPath: string,
    prefix: string,
    isRoot: boolean,
    out: string[],
    childFoldersByParent: ReadonlyMap<string, readonly string[]>,
    visibleFilesByFolder: ReadonlyMap<string, readonly AutoViewNode[]>,
    summariesByAnchor: ReadonlyMap<string, readonly CollapseCluster[]>,
): void {
    const childFolders: readonly string[] = [...(childFoldersByParent.get(folderPath) ?? [])]
        .sort((left, right) => path.posix.basename(left).localeCompare(path.posix.basename(right)))
    const summaries: readonly CollapseCluster[] = [...(summariesByAnchor.get(folderPath) ?? [])]
    const files: readonly AutoViewNode[] = [...(visibleFilesByFolder.get(folderPath) ?? [])]

    const entries: SpineEntry[] = [
        ...childFolders.map(childFolderPath => ({
            kind: 'folder' as const,
            folderPath: childFolderPath,
            sortKey: path.posix.basename(childFolderPath),
        })),
        ...summaries.map(cluster => ({
            kind: 'summary' as const,
            cluster,
            sortKey: cluster.label.replace(/\/$/, ''),
        })),
        ...files.map(node => ({
            kind: 'file' as const,
            node,
            sortKey: node.basename,
        })),
    ].sort(compareSpineEntries)

    entries.forEach((entry, index) => {
        const isLast: boolean = index === entries.length - 1
        const branch: string = isRoot ? '' : isLast ? '└── ' : '├── '
        const childPrefix: string = isRoot ? '' : prefix + (isLast ? '    ' : '│   ')
        if (entry.kind === 'folder') {
            out.push(`${prefix}${branch}▢ ${path.posix.basename(entry.folderPath)}/`)
            renderFolderEntries(entry.folderPath, childPrefix, false, out, childFoldersByParent, visibleFilesByFolder, summariesByAnchor)
            return
        }
        if (entry.kind === 'summary') {
            out.push(`${prefix}${branch}${formatCollapsedSummary(entry.cluster)}`)
            const expandCommand: string | undefined = formatExpandCommand(entry.cluster)
            if (expandCommand) {
                out.push(`${childPrefix}  ${expandCommand}`)
            }
            return
        }
        out.push(`${prefix}${branch}· ${entry.node.title} @[${entry.node.relPath}]`)
    })
}

function compareSpineEntries(left: SpineEntry, right: SpineEntry): number {
    const rank = (entry: SpineEntry): number => {
        if (entry.kind === 'folder') return 0
        if (entry.kind === 'summary') return 1
        return 2
    }
    const rankDelta: number = rank(left) - rank(right)
    if (rankDelta !== 0) return rankDelta
    return left.sortKey.localeCompare(right.sortKey)
}

function renderForests(graph: AutoViewGraph, clusters: readonly CollapseCluster[]): readonly string[] {
    const clusterByNodeId: ReadonlyMap<string, CollapseCluster> = buildClusterByNodeId(clusters)
    const clusterById = new Map<string, CollapseCluster>(clusters.map(cluster => [cluster.id, cluster]))
    const sections: string[] = []

    graph.forests.forEach((forest, index) => {
        const groupedTargets = new Map<string, string[]>()
        const seenEdges = new Set<string>()
        for (const edge of forest) {
            const src: string = clusterByNodeId.get(edge.src)?.id ?? edge.src
            const tgt: string = clusterByNodeId.get(edge.tgt)?.id ?? edge.tgt
            if (src === tgt) continue
            const edgeKey: string = `${src}\n${tgt}`
            if (seenEdges.has(edgeKey)) continue
            seenEdges.add(edgeKey)
            const targets: string[] = groupedTargets.get(src) ?? []
            targets.push(tgt)
            groupedTargets.set(src, targets)
        }

        if (groupedTargets.size === 0) return

        const sourceIds: readonly string[] = [...groupedTargets.keys()].sort((left, right) =>
            entitySortKey(left, graph.nodeById, clusterById).localeCompare(entitySortKey(right, graph.nodeById, clusterById)),
        )

        let edgeCount = 0
        const lines: string[] = []
        sourceIds.forEach(sourceId => {
            const targets: readonly string[] = groupedTargets.get(sourceId) ?? []
            edgeCount += targets.length
        })
        lines.push(`═══ COVER FOREST ${index + 1} (|E|=${edgeCount}) ═══`)

        for (const sourceId of sourceIds) {
            lines.push(`● ${renderForestEntity(sourceId, graph.nodeById, clusterById)}`)
            const targets: readonly string[] = groupedTargets.get(sourceId) ?? []
            targets.forEach((targetId, targetIndex) => {
                const branch: string = targetIndex === targets.length - 1 ? '└── ' : '├── '
                lines.push(`${branch}⇢ ${renderForestEntity(targetId, graph.nodeById, clusterById)}`)
            })
            lines.push('')
        }

        sections.push(lines.join('\n'))
    })

    return sections
}

function renderForestEntity(
    entityId: string,
    nodeById: ReadonlyMap<string, AutoViewNode>,
    clusterById: ReadonlyMap<string, CollapseCluster>,
): string {
    const cluster: CollapseCluster | undefined = clusterById.get(entityId)
    if (cluster) {
        return formatCollapsedSummary(cluster)
    }
    const node: AutoViewNode | undefined = nodeById.get(entityId)
    if (!node) {
        return entityId
    }
    return `${node.title} @[${node.relPath}]`
}

function entitySortKey(
    entityId: string,
    nodeById: ReadonlyMap<string, AutoViewNode>,
    clusterById: ReadonlyMap<string, CollapseCluster>,
): string {
    const cluster: CollapseCluster | undefined = clusterById.get(entityId)
    if (cluster) {
        return cluster.label
    }
    return nodeById.get(entityId)?.title ?? entityId
}

function formatCollapsedSummary(cluster: CollapseCluster): string {
    return `▢ ${cluster.label} [collapsed: ${cluster.nodeIds.length} nodes, ${cluster.incomingEdgeCount} edges in, ${cluster.outgoingEdgeCount} edges out]`
}

function formatExpandCommand(cluster: CollapseCluster): string | undefined {
    if (!cluster.representativeRelPath) return undefined
    return `expand: vt-graph live focus ${cluster.representativeRelPath} --hops 2`
}

function buildClusterByNodeId(clusters: readonly CollapseCluster[]): ReadonlyMap<string, CollapseCluster> {
    const clusterByNodeId = new Map<string, CollapseCluster>()
    for (const cluster of clusters) {
        cluster.nodeIds.forEach(nodeId => clusterByNodeId.set(nodeId, cluster))
    }
    return clusterByNodeId
}

function ancestorFolders(folderPath: string): readonly string[] {
    if (folderPath.length === 0) {
        return []
    }
    const segments: readonly string[] = folderPath.split('/').filter(Boolean)
    return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
}

function parentFolderPath(folderPath: string): string {
    const parent: string = path.posix.dirname(folderPath)
    return parent === '.' ? '' : parent
}
