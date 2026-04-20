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
    readonly pinnedFolderIds?: readonly string[]
}

export interface AutoViewNode extends CollapseBoundaryNode {
    readonly basename: string
}

export interface AutoViewGraph extends CollapseBoundaryGraph {
    readonly rootPath: string
    readonly nodes: readonly AutoViewNode[]
    readonly nodeById: ReadonlyMap<string, AutoViewNode>
    readonly edges: readonly DirectedEdge[]
    readonly forests: readonly (readonly DirectedEdge[])[]
    readonly arboricity: number
}

interface FolderSeed {
    readonly absPath: string
    readonly basename: string
    readonly folderPath: string
}

interface ClusterStats {
    readonly internalEdgeCount: number
    readonly incomingEdgeCount: number
    readonly outgoingEdgeCount: number
    readonly boundaryEdgeCount: number
    readonly cohesion: number
}

interface PinnedResolutionIndex {
    readonly folderByNormalizedAbsPath: ReadonlyMap<string, FolderSeed>
    readonly folderByNormalizedRelPath: ReadonlyMap<string, FolderSeed>
    readonly foldersByBasename: ReadonlyMap<string, readonly FolderSeed[]>
    readonly nodeByNormalizedRelPath: ReadonlyMap<string, AutoViewNode>
    readonly nodesByBasename: ReadonlyMap<string, readonly AutoViewNode[]>
}

interface AutoHeaderOptions {
    readonly pinningRequested: boolean
    readonly pinnedClusterCount: number
    readonly autoClusterCount: number
}

type ClusterDisplayLabelMap = ReadonlyMap<string, string>

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

export function buildAutoViewGraph(root: string): AutoViewGraph {
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

export function buildPinnedClusters(
    graph: AutoViewGraph,
    pinnedFolderIds: readonly string[],
): readonly CollapseCluster[] {
    if (pinnedFolderIds.length === 0) {
        return []
    }

    const folderSeeds: readonly FolderSeed[] = buildFolderSeeds(graph)
    const resolutionIndex: PinnedResolutionIndex = buildPinnedResolutionIndex(graph, folderSeeds)
    const seenFolderPaths = new Set<string>()
    const clusters: CollapseCluster[] = []

    for (const rawPinnedId of pinnedFolderIds) {
        const folderPath: string | undefined = resolvePinnedFolderPath(graph, resolutionIndex, rawPinnedId)
        if (!folderPath || seenFolderPaths.has(folderPath)) {
            continue
        }

        const nodeIds: readonly string[] = graph.nodes
            .filter(node => isNodeInsidePinnedFolder(node, folderPath))
            .map(node => node.id)
        if (nodeIds.length === 0) {
            console.error(
                `[folder-aware-view] ignoring pinned folder "${rawPinnedId}": folder "${folderPath}/" has no descendants`,
            )
            continue
        }

        const stats: ClusterStats = computeClusterStats(nodeIds, graph.edges)
        const representativeRelPath: string = pickPinnedRepresentativeRelPath(graph, nodeIds, folderPath)
        clusters.push({
            id: `pinned:${folderPath}`,
            label: `${folderPath}/`,
            strategy: 'folder-first',
            nodeIds,
            anchorFolderPath: parentFolderPath(folderPath),
            alignedFolderPath: folderPath,
            representativeRelPath,
            internalEdgeCount: stats.internalEdgeCount,
            incomingEdgeCount: stats.incomingEdgeCount,
            outgoingEdgeCount: stats.outgoingEdgeCount,
            boundaryEdgeCount: stats.boundaryEdgeCount,
            cohesion: stats.cohesion,
        })
        seenFolderPaths.add(folderPath)
    }

    return [...clusters].sort((left, right) => left.label.localeCompare(right.label))
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
    const requestedPinnedIds: readonly string[] = options.pinnedFolderIds ?? []
    const pinnedClusters: readonly CollapseCluster[] = buildPinnedClusters(graph, requestedPinnedIds)
    const pinnedNodeIds = new Set<string>(pinnedClusters.flatMap(cluster => cluster.nodeIds))
    const remainingNodes: readonly AutoViewNode[] = graph.nodes.filter(node => !pinnedNodeIds.has(node.id))
    const remainingBudget: number = budget - pinnedClusters.length
    const autoClusters: readonly CollapseCluster[] =
        remainingBudget <= 0
            ? []
            : findCollapseBoundary(
                  {rootName: graph.rootName, nodes: remainingNodes},
                  remainingBudget,
                  {
                      selectedIds: options.selectedIds,
                      focusNodeId: options.focusNodeId,
                  },
              )
    const clusters: readonly CollapseCluster[] = [...pinnedClusters, ...autoClusters]
    const displayLabelByClusterId: ClusterDisplayLabelMap = buildClusterDisplayLabelMap(clusters)
    const visibleEntityCount: number = countVisibleEntities(graph.nodes.length, clusters)
    const body: string = renderTreeCoverBody(graph, clusters, displayLabelByClusterId)
    const header: string = buildAutoHeader(graph, clusters, budget, visibleEntityCount, {
        pinningRequested: requestedPinnedIds.length > 0,
        pinnedClusterCount: pinnedClusters.length,
        autoClusterCount: autoClusters.length,
    }, displayLabelByClusterId)
    const footer: string = buildAutoFooter(clusters)

    return {output: footer.length > 0 ? `${header}\n${body}\n${footer}` : `${header}\n${body}`, format: 'tree-cover'}
}

function buildAutoHeader(
    graph: AutoViewGraph,
    clusters: readonly CollapseCluster[],
    budget: number,
    visibleEntityCount: number,
    options: AutoHeaderOptions,
    displayLabelByClusterId: ClusterDisplayLabelMap,
): string {
    const collapsedNodeCount: number = clusters.reduce((sum, cluster) => sum + cluster.nodeIds.length, 0)
    const visibleNodeCount: number = graph.nodes.length - collapsedNodeCount
    const strategy: string = resolveCollapseStrategy(clusters, options)
    const pinnedSuffix: string = options.pinningRequested ? ` pinned=${options.pinnedClusterCount}` : ''
    const lines: string[] = [
        '# format: tree-cover (auto-selected)',
        `# graph: N=${graph.nodes.length} E=${graph.edges.length} a(G)=${graph.arboricity} forests=${graph.forests.length}`,
        `# budget: ${budget} visible entities (expanded nodes + cluster summaries)`,
        clusters.length === 0
            ? `# collapse: none (visible=${visibleEntityCount} <= budget=${budget})${pinnedSuffix}`
            : `# collapse: strategy=${strategy} visible=${visibleEntityCount}${pinnedSuffix} visibleNodes=${visibleNodeCount} collapsedNodes=${collapsedNodeCount} clusters=${clusters.length}`,
    ]

    for (const cluster of clusters) {
        lines.push(
            `# cluster: ${formatCollapsedSummary(cluster, displayLabelByClusterId)} cohesion=${cluster.cohesion.toFixed(2)} reason=${cluster.strategy}`,
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

function renderTreeCoverBody(
    graph: AutoViewGraph,
    clusters: readonly CollapseCluster[],
    displayLabelByClusterId: ClusterDisplayLabelMap,
): string {
    const spine: string = renderSpine(graph, clusters, displayLabelByClusterId)
    const forests: readonly string[] = renderForests(graph, clusters, displayLabelByClusterId)
    return [
        '═══ SPINE (folder hierarchy, no content edges) ═══',
        spine,
        '',
        ...forests.flatMap(section => [section, '']),
    ].join('\n')
}

function renderSpine(
    graph: AutoViewGraph,
    clusters: readonly CollapseCluster[],
    displayLabelByClusterId: ClusterDisplayLabelMap,
): string {
    const clusterByNodeId: ReadonlyMap<string, CollapseCluster> = buildClusterByNodeId(clusters)
    const visibleFilesByFolder = new Map<string, AutoViewNode[]>()
    const summariesByAnchor = new Map<string, CollapseCluster[]>()
    const requiredFolders = new Set<string>()

    for (const node of graph.nodes) {
        if (node.kind === 'folder') continue
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
    renderFolderEntries(
        '',
        '',
        false,
        lines,
        childFoldersByParent,
        visibleFilesByFolder,
        summariesByAnchor,
        displayLabelByClusterId,
    )
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
    displayLabelByClusterId: ClusterDisplayLabelMap,
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
            sortKey: resolveClusterDisplayLabel(cluster, displayLabelByClusterId).replace(/\/$/, ''),
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
            renderFolderEntries(
                entry.folderPath,
                childPrefix,
                false,
                out,
                childFoldersByParent,
                visibleFilesByFolder,
                summariesByAnchor,
                displayLabelByClusterId,
            )
            return
        }
        if (entry.kind === 'summary') {
            out.push(`${prefix}${branch}${formatCollapsedSummary(entry.cluster, displayLabelByClusterId)}`)
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

function renderForests(
    graph: AutoViewGraph,
    clusters: readonly CollapseCluster[],
    displayLabelByClusterId: ClusterDisplayLabelMap,
): readonly string[] {
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
            entitySortKey(left, graph.nodeById, clusterById, displayLabelByClusterId).localeCompare(
                entitySortKey(right, graph.nodeById, clusterById, displayLabelByClusterId),
            ),
        )

        let edgeCount = 0
        const lines: string[] = []
        sourceIds.forEach(sourceId => {
            const targets: readonly string[] = groupedTargets.get(sourceId) ?? []
            edgeCount += targets.length
        })
        lines.push(`═══ COVER FOREST ${index + 1} (|E|=${edgeCount}) ═══`)

        for (const sourceId of sourceIds) {
            lines.push(`● ${renderForestEntity(sourceId, graph.nodeById, clusterById, displayLabelByClusterId)}`)
            const targets: readonly string[] = groupedTargets.get(sourceId) ?? []
            targets.forEach((targetId, targetIndex) => {
                const branch: string = targetIndex === targets.length - 1 ? '└── ' : '├── '
                lines.push(`${branch}⇢ ${renderForestEntity(targetId, graph.nodeById, clusterById, displayLabelByClusterId)}`)
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
    displayLabelByClusterId: ClusterDisplayLabelMap,
): string {
    const cluster: CollapseCluster | undefined = clusterById.get(entityId)
    if (cluster) {
        return formatCollapsedSummary(cluster, displayLabelByClusterId)
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
    displayLabelByClusterId: ClusterDisplayLabelMap,
): string {
    const cluster: CollapseCluster | undefined = clusterById.get(entityId)
    if (cluster) {
        return resolveClusterDisplayLabel(cluster, displayLabelByClusterId)
    }
    return nodeById.get(entityId)?.title ?? entityId
}

function formatCollapsedSummary(
    cluster: CollapseCluster,
    displayLabelByClusterId: ClusterDisplayLabelMap,
): string {
    const displayLabel: string = resolveClusterDisplayLabel(cluster, displayLabelByClusterId)
    return `▢ ${displayLabel} [collapsed: ${cluster.nodeIds.length} nodes, ${cluster.incomingEdgeCount} edges in, ${cluster.outgoingEdgeCount} edges out]`
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

export function buildClusterDisplayLabelMap(
    clusters: readonly CollapseCluster[],
): ClusterDisplayLabelMap {
    const displayLabelByClusterId = new Map<string, string>(clusters.map(cluster => [cluster.id, cluster.label]))
    const clustersByBasename = new Map<string, CollapseCluster[]>()

    for (const cluster of clusters) {
        if (!cluster.alignedFolderPath) {
            continue
        }
        const basename: string = path.posix.basename(cluster.alignedFolderPath)
        const bucket: CollapseCluster[] = clustersByBasename.get(basename) ?? []
        bucket.push(cluster)
        clustersByBasename.set(basename, bucket)
    }

    for (const [basename, alignedClusters] of clustersByBasename) {
        if (alignedClusters.length === 1) {
            displayLabelByClusterId.set(alignedClusters[0]!.id, `${basename}/`)
            continue
        }

        const disambiguatedLabels: readonly string[] = buildMinimumDisambiguatingFolderLabels(alignedClusters)
        alignedClusters.forEach((cluster, index) => {
            displayLabelByClusterId.set(cluster.id, disambiguatedLabels[index]!)
        })
    }

    return displayLabelByClusterId
}

function buildMinimumDisambiguatingFolderLabels(
    clusters: readonly CollapseCluster[],
): readonly string[] {
    const segmentLists: readonly (readonly string[])[] = clusters.map(cluster =>
        splitFolderPathSegments(cluster.alignedFolderPath ?? cluster.label.replace(/\/$/, '')),
    )
    const maxDepth: number = segmentLists.reduce((max, segments) => Math.max(max, segments.length), 0)

    for (let depth = 1; depth <= maxDepth; depth += 1) {
        const labels: readonly string[] = segmentLists.map(segments => `${segments.slice(-depth).join('/')}/`)
        if (new Set(labels).size === labels.length) {
            return labels
        }
    }

    return clusters.map(cluster => `${cluster.alignedFolderPath ?? cluster.label.replace(/\/$/, '')}/`)
}

function splitFolderPathSegments(folderPath: string): readonly string[] {
    return folderPath.split('/').filter(segment => segment.length > 0)
}

function resolveClusterDisplayLabel(
    cluster: CollapseCluster,
    displayLabelByClusterId: ClusterDisplayLabelMap,
): string {
    return displayLabelByClusterId.get(cluster.id) ?? cluster.label
}

function buildFolderSeeds(graph: AutoViewGraph): readonly FolderSeed[] {
    const explicitFolderSeeds: readonly FolderSeed[] = graph.nodes
        .filter((node): node is AutoViewNode & {readonly kind: 'folder'} => node.kind === 'folder')
        .map(node => {
            const folderPath: string = normalizeFolderSeedPath(node.relPath)
            return {
                absPath: normalizeFolderSeedPath(path.resolve(graph.rootPath, folderPath)),
                basename: path.posix.basename(folderPath),
                folderPath,
            }
        })
        .filter(seed => seed.folderPath.length > 0)
    if (explicitFolderSeeds.length > 0) {
        return dedupeFolderSeeds(explicitFolderSeeds)
    }

    const hasMissingKindMetadata: boolean = graph.nodes.some(node => node.kind === undefined)
    if (!hasMissingKindMetadata) {
        return []
    }

    const legacyFolderPaths = new Set<string>()
    for (const node of graph.nodes) {
        if (node.kind === 'folder') continue
        ancestorFolders(node.folderPath).forEach(folderPath => legacyFolderPaths.add(folderPath))
    }

    return [...legacyFolderPaths]
        .sort((left, right) => left.localeCompare(right))
        .map(folderPath => ({
            absPath: normalizeFolderSeedPath(path.resolve(graph.rootPath, folderPath)),
            basename: path.posix.basename(folderPath),
            folderPath,
        }))
}

function dedupeFolderSeeds(folderSeeds: readonly FolderSeed[]): readonly FolderSeed[] {
    const deduped = new Map<string, FolderSeed>()
    for (const folderSeed of folderSeeds) {
        deduped.set(folderSeed.folderPath, folderSeed)
    }
    return [...deduped.values()].sort((left, right) => left.folderPath.localeCompare(right.folderPath))
}

function buildPinnedResolutionIndex(
    graph: AutoViewGraph,
    folderSeeds: readonly FolderSeed[],
): PinnedResolutionIndex {
    const folderByNormalizedAbsPath = new Map<string, FolderSeed>()
    const folderByNormalizedRelPath = new Map<string, FolderSeed>()
    const foldersByBasename = new Map<string, FolderSeed[]>()
    for (const folderSeed of folderSeeds) {
        folderByNormalizedAbsPath.set(normalizeFolderSeedPath(folderSeed.absPath), folderSeed)
        folderByNormalizedRelPath.set(normalizeFolderSeedPath(folderSeed.folderPath), folderSeed)
        const entries: FolderSeed[] = foldersByBasename.get(folderSeed.basename) ?? []
        entries.push(folderSeed)
        foldersByBasename.set(folderSeed.basename, entries)
    }

    const nodeByNormalizedRelPath = new Map<string, AutoViewNode>()
    const nodesByBasename = new Map<string, AutoViewNode[]>()
    for (const node of graph.nodes) {
        nodeByNormalizedRelPath.set(normalizeSelectableId(node.relPath), node)
        const basename: string = path.posix.basename(normalizeSelectableId(node.relPath))
        const entries: AutoViewNode[] = nodesByBasename.get(basename) ?? []
        entries.push(node)
        nodesByBasename.set(basename, entries)
    }

    return {
        folderByNormalizedAbsPath,
        folderByNormalizedRelPath,
        foldersByBasename,
        nodeByNormalizedRelPath,
        nodesByBasename,
    }
}

function resolvePinnedFolderPath(
    graph: AutoViewGraph,
    index: PinnedResolutionIndex,
    rawPinnedId: string,
): string | undefined {
    const trimmed: string = rawPinnedId.trim()
    if (trimmed.length === 0) {
        return undefined
    }

    const directNodeMatch: AutoViewNode | undefined = graph.nodeById.get(trimmed)
    if (directNodeMatch) {
        return resolveFolderPathFromNode(rawPinnedId, directNodeMatch)
    }

    const normalizedFolderSeed: string = normalizeFolderSeedPath(trimmed)
    const normalizedNodeSeed: string = normalizeSelectableId(trimmed)

    const directFolderMatch: FolderSeed | undefined =
        index.folderByNormalizedAbsPath.get(normalizedFolderSeed) ??
        index.folderByNormalizedRelPath.get(normalizedFolderSeed)
    if (directFolderMatch) {
        return directFolderMatch.folderPath
    }

    const relPathNodeMatch: AutoViewNode | undefined = index.nodeByNormalizedRelPath.get(normalizedNodeSeed)
    if (relPathNodeMatch) {
        return resolveFolderPathFromNode(rawPinnedId, relPathNodeMatch)
    }

    const basename: string = path.posix.basename(normalizedFolderSeed)
    const folderBasenameMatches: readonly FolderSeed[] = index.foldersByBasename.get(basename) ?? []
    if (folderBasenameMatches.length === 1) {
        return folderBasenameMatches[0]!.folderPath
    }

    const nodeBasenameMatches: readonly AutoViewNode[] = index.nodesByBasename.get(path.posix.basename(normalizedNodeSeed)) ?? []
    if (nodeBasenameMatches.length === 1) {
        return resolveFolderPathFromNode(rawPinnedId, nodeBasenameMatches[0]!)
    }

    console.error(`[folder-aware-view] ignoring pinned folder "${rawPinnedId}": no matching folder found`)
    return undefined
}

function resolveFolderPathFromNode(
    rawPinnedId: string,
    node: AutoViewNode,
): string | undefined {
    if (node.kind === 'folder') {
        return normalizeFolderSeedPath(node.relPath)
    }
    console.error(
        `[folder-aware-view] ignoring pinned folder "${rawPinnedId}": resolved node "${node.relPath}" is not a folder`,
    )
    return undefined
}

function normalizeSelectableId(value: string): string {
    return value.replace(/\\/g, '/').replace(/\.md$/i, '')
}

function normalizeFolderSeedPath(value: string): string {
    return normalizeSelectableId(value).replace(/\/+$/g, '')
}

function isNodeInsidePinnedFolder(node: AutoViewNode, folderPath: string): boolean {
    if (folderPath.length === 0) {
        return false
    }
    if (node.kind === 'folder') {
        const nodeFolderPath: string = normalizeFolderSeedPath(node.relPath)
        return isSamePathOrDescendant(nodeFolderPath, folderPath) && nodeFolderPath !== folderPath
    }
    return isSamePathOrDescendant(node.folderPath, folderPath)
}

function isSamePathOrDescendant(candidatePath: string, folderPath: string): boolean {
    return candidatePath === folderPath || candidatePath.startsWith(`${folderPath}/`)
}

function computeClusterStats(
    nodeIds: readonly string[],
    edges: readonly DirectedEdge[],
): ClusterStats {
    const nodeSet: ReadonlySet<string> = new Set(nodeIds)
    let internalEdgeCount = 0
    let incomingEdgeCount = 0
    let outgoingEdgeCount = 0

    for (const edge of edges) {
        const srcInside: boolean = nodeSet.has(edge.src)
        const tgtInside: boolean = nodeSet.has(edge.tgt)
        if (srcInside && tgtInside) {
            internalEdgeCount += 1
        } else if (!srcInside && tgtInside) {
            incomingEdgeCount += 1
        } else if (srcInside && !tgtInside) {
            outgoingEdgeCount += 1
        }
    }

    const boundaryEdgeCount: number = incomingEdgeCount + outgoingEdgeCount
    const denominator: number = internalEdgeCount + boundaryEdgeCount
    return {
        internalEdgeCount,
        incomingEdgeCount,
        outgoingEdgeCount,
        boundaryEdgeCount,
        cohesion: denominator === 0 ? 1 : internalEdgeCount / denominator,
    }
}

function pickPinnedRepresentativeRelPath(
    graph: AutoViewGraph,
    nodeIds: readonly string[],
    folderPath: string,
): string {
    const preferredRelPath: string = `${folderPath}/index.md`
    const preferredNode: AutoViewNode | undefined = nodeIds
        .map(nodeId => graph.nodeById.get(nodeId))
        .find(node => node?.relPath === preferredRelPath)
    if (preferredNode) {
        return preferredNode.relPath
    }
    return [...nodeIds]
        .map(nodeId => graph.nodeById.get(nodeId))
        .filter((node): node is AutoViewNode => node !== undefined)
        .sort((left, right) => left.relPath.localeCompare(right.relPath))[0]?.relPath ?? ''
}

function resolveCollapseStrategy(
    clusters: readonly CollapseCluster[],
    options: AutoHeaderOptions,
): string {
    if (clusters.length === 0) {
        return 'none'
    }
    if (options.pinnedClusterCount > 0 && options.autoClusterCount > 0) {
        return 'mixed'
    }
    return clusters[0]?.strategy ?? 'none'
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
