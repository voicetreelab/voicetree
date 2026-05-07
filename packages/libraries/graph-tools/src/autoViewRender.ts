import * as path from 'node:path'
import {type CollapseCluster} from './collapseBoundary'
import {type AutoViewNode, type AutoViewGraph} from './autoView'

export type ClusterDisplayLabelMap = ReadonlyMap<string, string>

export interface AutoHeaderOptions {
    readonly pinningRequested: boolean
    readonly pinnedClusterCount: number
    readonly autoClusterCount: number
}

type SpineEntry =
    | {readonly kind: 'folder'; readonly folderPath: string; readonly sortKey: string}
    | {readonly kind: 'summary'; readonly cluster: CollapseCluster; readonly sortKey: string}
    | {readonly kind: 'file'; readonly node: AutoViewNode; readonly sortKey: string}

export function buildAutoHeader(
    graph: AutoViewGraph,
    clusters: readonly CollapseCluster[],
    budget: number,
    visibleEntityCount: number,
    options: AutoHeaderOptions,
    displayLabelByClusterId: ClusterDisplayLabelMap,
    userCollapsedClusterIds?: ReadonlySet<string>,
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
            `# cluster: ${formatCollapsedSummary(cluster, displayLabelByClusterId, userCollapsedClusterIds)} cohesion=${cluster.cohesion.toFixed(2)} reason=${cluster.strategy}`,
        )
    }

    return lines.join('\n')
}

export function buildAutoFooter(clusters: readonly CollapseCluster[]): string {
    if (clusters.length === 0) return ''
    return [
        '',
        '# hint: to expand a collapsed ▢ cluster, run the `expand:` command printed beside it',
        '#       (requires a live vt-graph server; alternatively raise --budget=N to see more)',
    ].join('\n')
}

export function renderTreeCoverBody(
    graph: AutoViewGraph,
    clusters: readonly CollapseCluster[],
    displayLabelByClusterId: ClusterDisplayLabelMap,
    selectedIds?: ReadonlySet<string>,
    userCollapsedClusterIds?: ReadonlySet<string>,
): string {
    const spine: string = renderSpine(graph, clusters, displayLabelByClusterId, selectedIds, userCollapsedClusterIds)
    const forests: readonly string[] = renderForests(graph, clusters, displayLabelByClusterId, selectedIds, userCollapsedClusterIds)
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
    selectedIds?: ReadonlySet<string>,
    userCollapsedClusterIds?: ReadonlySet<string>,
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
        selectedIds,
        userCollapsedClusterIds,
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
    selectedIds?: ReadonlySet<string>,
    userCollapsedClusterIds?: ReadonlySet<string>,
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
                selectedIds,
                userCollapsedClusterIds,
            )
            return
        }
        if (entry.kind === 'summary') {
            out.push(`${prefix}${branch}${formatCollapsedSummary(entry.cluster, displayLabelByClusterId, userCollapsedClusterIds)}`)
            const expandCommand: string | undefined = formatExpandCommand(entry.cluster)
            if (expandCommand) {
                out.push(`${childPrefix}  ${expandCommand}`)
            }
            return
        }
        const fileGlyph: string = selectedIds?.has(entry.node.id) ? '★' : '·'
        out.push(`${prefix}${branch}${fileGlyph} ${entry.node.title} @[${entry.node.relPath}]`)
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
    selectedIds?: ReadonlySet<string>,
    userCollapsedClusterIds?: ReadonlySet<string>,
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
            lines.push(`● ${renderForestEntity(sourceId, graph.nodeById, clusterById, displayLabelByClusterId, selectedIds, userCollapsedClusterIds)}`)
            const targets: readonly string[] = groupedTargets.get(sourceId) ?? []
            targets.forEach((targetId, targetIndex) => {
                const branch: string = targetIndex === targets.length - 1 ? '└── ' : '├── '
                lines.push(`${branch}⇢ ${renderForestEntity(targetId, graph.nodeById, clusterById, displayLabelByClusterId, selectedIds, userCollapsedClusterIds)}`)
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
    selectedIds?: ReadonlySet<string>,
    userCollapsedClusterIds?: ReadonlySet<string>,
): string {
    const cluster: CollapseCluster | undefined = clusterById.get(entityId)
    if (cluster) {
        return formatCollapsedSummary(cluster, displayLabelByClusterId, userCollapsedClusterIds)
    }
    const node: AutoViewNode | undefined = nodeById.get(entityId)
    if (!node) {
        return entityId
    }
    const nodeGlyph: string = selectedIds?.has(node.id) ? '★ ' : ''
    return `${nodeGlyph}${node.title} @[${node.relPath}]`
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
    userCollapsedClusterIds?: ReadonlySet<string>,
): string {
    const displayLabel: string = resolveClusterDisplayLabel(cluster, displayLabelByClusterId)
    const collapseType: string = userCollapsedClusterIds?.has(cluster.id) ? 'user' : 'auto'
    return `▢ ${displayLabel} [collapsed:${collapseType} ${cluster.nodeIds.length} nodes, ${cluster.incomingEdgeCount} edges in, ${cluster.outgoingEdgeCount} edges out]`
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

export function ancestorFolders(folderPath: string): readonly string[] {
    if (folderPath.length === 0) {
        return []
    }
    const segments: readonly string[] = folderPath.split('/').filter(Boolean)
    return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
}

export function parentFolderPath(folderPath: string): string {
    const parent: string = path.posix.dirname(folderPath)
    return parent === '.' ? '' : parent
}
