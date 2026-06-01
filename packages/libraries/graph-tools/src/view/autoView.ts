import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Graph} from '@vt/graph-model'

interface ProjectedNode {
    readonly id: string
    readonly kind: 'file' | 'folder' | 'folder-collapsed'
    readonly label: string
    readonly relPath: string
    readonly basename: string
    readonly folderPath: string
    readonly parent?: string
    readonly position?: {readonly x: number; readonly y: number}
    readonly classes?: readonly string[]
    readonly color?: string
    readonly content: string
    readonly additionalYAMLProps?: readonly (readonly [string, string])[]
    readonly loadState?: 'loaded' | 'not-loaded'
    readonly isWriteTarget?: boolean
    readonly childCount?: number
    readonly isContextNode?: boolean
    readonly containedNodeIds?: readonly string[]
}

interface ProjectedEdge {
    readonly id: string
    readonly source: string
    readonly target: string
    readonly kind: 'real' | 'synthetic'
    readonly label?: string
    readonly classes?: readonly string[]
    readonly edgeCount?: number
}

interface TreeEdge {
    readonly source: string
    readonly target: string
}

export interface ProjectedGraph {
    readonly nodes: readonly ProjectedNode[]
    readonly edges: readonly ProjectedEdge[]
    readonly rootPath: string
    readonly revision: number
    readonly forests: readonly (readonly TreeEdge[])[]
    readonly arboricity: number
}
import {
    scanMarkdownFiles,
    getNodeId,
    extractLinks,
    buildUniqueBasenameMap,
    resolveLinkTarget,
    type StructureNode,
} from '../core/primitives'
import {
    countVisibleEntities,
    findCollapseBoundary,
    type CollapseBoundaryNode,
    type CollapseCluster,
} from './collapseBoundary'
import {
    computeArboricity,
    deriveTitle,
    relId,
    type DirectedEdge,
} from '@vt/graph-tools/scripts/L3-BF-192-tree-cover-render'
import {
    buildAutoHeader,
    buildAutoFooter,
    renderTreeCoverBody,
    buildClusterDisplayLabelMap,
    ancestorFolders,
    type ClusterDisplayLabelMap,
} from './autoViewRender'
import {buildPinnedClusters} from './autoViewPinning'

export {buildClusterDisplayLabelMap} from './autoViewRender'
export {buildPinnedClusters} from './autoViewPinning'

const DEFAULT_BUDGET = 30

export interface AutoViewOptions {
    readonly budget?: number
    readonly selectedIds?: readonly string[]
    readonly focusNodeId?: string
    readonly pinnedFolderIds?: readonly string[]
}

export interface RenderNode extends CollapseBoundaryNode {
    readonly basename: string
    readonly collapsedChildCount?: number
}

export interface RenderGraph {
    readonly rootPath: string
    readonly rootName: string
    readonly nodes: readonly RenderNode[]
    readonly nodeById: ReadonlyMap<string, RenderNode>
    readonly edges: readonly DirectedEdge[]
    readonly forests: readonly (readonly DirectedEdge[])[]
    readonly arboricity: number
}

function normalizeRenderFolderPath(rootPath: string, folderPath: string): string {
    const trimmedFolderPath = folderPath.endsWith('/') ? folderPath.slice(0, -1) : folderPath
    if (trimmedFolderPath === rootPath) return ''
    if (trimmedFolderPath.startsWith(`${rootPath}/`)) {
        return trimmedFolderPath.slice(rootPath.length + 1)
    }

    return folderPath
}

export function deriveRenderGraph(graph: ProjectedGraph): RenderGraph {
    const rootName = path.basename(graph.rootPath)

    const outgoingMap = new Map<string, string[]>()
    const edges: DirectedEdge[] = []
    for (const edge of graph.edges) {
        edges.push({src: edge.source, tgt: edge.target})
        const list = outgoingMap.get(edge.source) ?? []
        list.push(edge.target)
        outgoingMap.set(edge.source, list)
    }

    const nodes: RenderNode[] = graph.nodes.map(n => ({
        id: n.id,
        title: n.label,
        relPath: n.relPath,
        folderPath: normalizeRenderFolderPath(graph.rootPath, n.folderPath),
        basename: n.basename,
        outgoingIds: outgoingMap.get(n.id) ?? [],
        kind: n.kind === 'folder-collapsed' ? 'folder' as const : n.kind,
        ...(n.kind === 'folder-collapsed' ? {collapsedChildCount: n.childCount ?? 0} : {}),
    }))

    const nodeById = new Map(nodes.map(n => [n.id, n]))

    const forests = graph.forests.map(forest =>
        forest.map(e => ({src: e.source, tgt: e.target}) as DirectedEdge),
    )

    return {rootPath: graph.rootPath, rootName, nodes, nodeById, edges, forests, arboricity: graph.arboricity}
}

function buildProjectedGraphFromProject(root: string): ProjectedGraph {
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

    const projectedNodes: ProjectedNode[] = []
    const projectedEdges: ProjectedEdge[] = []
    const directedEdges: DirectedEdge[] = []

    for (const [id, content] of contentMap) {
        const absPath = path.join(root, id + '.md')
        const nodeRelPath: string = relId(absPath, root)
        const basename: string = path.posix.basename(nodeRelPath)
        const folderPathRaw: string = path.posix.dirname(nodeRelPath)
        const folderPath: string = folderPathRaw === '.' ? '' : folderPathRaw
        const label: string = deriveTitle(content, path.basename(absPath, '.md'))

        for (const link of extractLinks(content)) {
            const target = resolveLinkTarget(link, id, structureNodes, uniqueBasenames)
            if (target && target !== id) {
                const targetAbsPath = path.join(root, target + '.md')
                projectedEdges.push({id: `${absPath}->${targetAbsPath}`, source: absPath, target: targetAbsPath, kind: 'real'})
                directedEdges.push({src: absPath, tgt: targetAbsPath})
            }
        }

        projectedNodes.push({id: absPath, kind: 'file', label, relPath: nodeRelPath, basename, folderPath, content})
    }

    const cover = computeArboricity(projectedNodes.length, directedEdges)
    const forests: (readonly TreeEdge[])[] = cover.forests.map(forest =>
        forest.map(e => ({source: e.src, target: e.tgt})),
    )

    return {nodes: projectedNodes, edges: projectedEdges, rootPath: root, revision: 0, forests, arboricity: cover.arboricityUpperBound}
}

export function buildAutoViewGraphFromState(graphState: Graph, rootPath: string): ProjectedGraph {
    const projectedNodes: ProjectedNode[] = []
    const projectedEdges: ProjectedEdge[] = []
    const directedEdges: DirectedEdge[] = []
    const existingIds = new Set<string>()

    for (const [id, node] of Object.entries(graphState.nodes)) {
        existingIds.add(id)
        const nodeRelPath: string = relId(id, rootPath)
        const basename: string = path.posix.basename(nodeRelPath)
        const folderPathRaw: string = path.posix.dirname(nodeRelPath)
        const folderPath: string = folderPathRaw === '.' ? '' : folderPathRaw
        const label: string = deriveTitle(node.contentWithoutYamlOrLinks, path.basename(id, '.md'))
        const kind: 'file' | 'folder' = node.kind === 'folder' ? 'folder' : 'file'

        projectedNodes.push({id, kind, label, relPath: nodeRelPath, basename, folderPath, content: node.contentWithoutYamlOrLinks ?? ''})

        for (const edge of node.outgoingEdges) {
            if (edge.targetId === id) continue
            projectedEdges.push({id: `${id}->${edge.targetId}`, source: id, target: edge.targetId, kind: 'real'})
            directedEdges.push({src: id, tgt: edge.targetId})
        }
    }

    const folderPaths = new Set<string>()
    for (const node of projectedNodes) {
        if (node.kind !== 'folder') {
            const fp: string = path.posix.dirname(relId(node.id, rootPath))
            const nodeFolderPath: string = fp === '.' ? '' : fp
            if (nodeFolderPath.length > 0) {
                for (const folder of ancestorFolders(nodeFolderPath)) {
                    folderPaths.add(folder)
                }
            }
        }
    }

    for (const fp of folderPaths) {
        const folderId = path.join(rootPath, fp)
        if (!existingIds.has(folderId)) {
            const folderBasename: string = path.posix.basename(fp)
            const parentFolder: string = path.posix.dirname(fp)
            projectedNodes.push({
                id: folderId,
                kind: 'folder',
                label: folderBasename,
                relPath: fp,
                basename: folderBasename,
                folderPath: parentFolder === '.' ? '' : parentFolder,
                content: '',
            })
        }
    }

    const cover = computeArboricity(projectedNodes.length, directedEdges)
    const forests: (readonly TreeEdge[])[] = cover.forests.map(forest =>
        forest.map(e => ({source: e.src, target: e.tgt})),
    )

    return {nodes: projectedNodes, edges: projectedEdges, rootPath, revision: 0, forests, arboricity: cover.arboricityUpperBound}
}

export function buildAutoViewGraph(root: string): ProjectedGraph {
    return buildProjectedGraphFromProject(root)
}

export interface RenderTreeCoverOptions {
    readonly collapsed?: ReadonlySet<string>
    readonly selected?: ReadonlySet<string>
    readonly budget?: number
    readonly title?: string
    readonly viewApplied?: boolean
    readonly focusNodeId?: string
    readonly pinnedFolderIds?: readonly string[]
    readonly warn?: (message: string) => void
}

export function renderTreeCover(graph: ProjectedGraph, opts?: RenderTreeCoverOptions): string {
    if (graph.nodes.length === 0) {
        return ''
    }

    const rg: RenderGraph = deriveRenderGraph(graph)

    const budget: number = Math.max(1, Math.trunc(opts?.budget ?? DEFAULT_BUDGET))
    const requestedPinnedIds: readonly string[] = [
        ...(opts?.collapsed ? [...opts.collapsed] : []),
        ...(opts?.pinnedFolderIds ?? []),
    ]
    const pinnedClusters: readonly CollapseCluster[] = buildPinnedClusters(rg, requestedPinnedIds, opts?.warn)
    const pinnedNodeIds = new Set<string>(pinnedClusters.flatMap(cluster => cluster.nodeIds))
    const remainingNodes: readonly RenderNode[] = rg.nodes.filter(node => !pinnedNodeIds.has(node.id))
    const remainingBudget: number = budget - pinnedNodeIds.size
    const selectedIds: readonly string[] | undefined = opts?.selected ? [...opts.selected] : undefined
    const autoClusters: readonly CollapseCluster[] =
        remainingBudget <= 0
            ? []
            : findCollapseBoundary(
                  {rootName: rg.rootName, nodes: remainingNodes},
                  remainingBudget,
                  {
                      selectedIds,
                      focusNodeId: opts?.focusNodeId,
                  },
              )
    const clusters: readonly CollapseCluster[] = [...pinnedClusters, ...autoClusters]
    const displayLabelByClusterId: ClusterDisplayLabelMap = buildClusterDisplayLabelMap(clusters)
    const visibleEntityCount: number = countVisibleEntities(rg.nodes.length, clusters)
    const userCollapsedClusterIds: ReadonlySet<string> = buildUserCollapsedClusterIds(rg, clusters, opts?.collapsed)
    const body: string = renderTreeCoverBody(rg, clusters, displayLabelByClusterId, opts?.selected, userCollapsedClusterIds)
    const header: string = buildAutoHeader(rg, clusters, budget, visibleEntityCount, {
        pinningRequested: requestedPinnedIds.length > 0,
        pinnedClusterCount: pinnedClusters.length,
        autoClusterCount: autoClusters.length,
    }, displayLabelByClusterId, userCollapsedClusterIds)
    const footer: string = buildAutoFooter(clusters)

    const fallbackFolderName: string = path.basename(rg.rootPath)
    const folderName: string = opts?.title ?? fallbackFolderName
    const viewApplied: boolean = opts?.viewApplied ?? (
        (opts?.collapsed !== undefined && opts.collapsed.size > 0) ||
        (opts?.selected !== undefined && opts.selected.size > 0)
    )
    const structureHeader: string = `═══ STRUCTURE ${folderName}${viewApplied ? ' (view applied)' : ''} ═══`

    return footer.length > 0
        ? `${structureHeader}\n${header}\n${body}\n${footer}`
        : `${structureHeader}\n${header}\n${body}`
}

function buildUserCollapsedClusterIds(
    graph: RenderGraph,
    clusters: readonly CollapseCluster[],
    collapsed: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
    if (!collapsed || collapsed.size === 0) return new Set()
    const userIds = new Set<string>()
    for (const cluster of clusters) {
        const absFolder: string | undefined = cluster.alignedFolderPath
            ? path.join(graph.rootPath, cluster.alignedFolderPath)
            : undefined
        if (
            (absFolder !== undefined && collapsed.has(absFolder)) ||
            (cluster.alignedFolderPath !== undefined && collapsed.has(cluster.alignedFolderPath)) ||
            cluster.nodeIds.some(nodeId => collapsed.has(nodeId))
        ) {
            userIds.add(cluster.id)
        }
    }
    return userIds
}

export function renderAutoView(
    projectRoot: string,
    options: AutoViewOptions = {},
): {output: string; format: string} {
    const root: string = path.resolve(projectRoot)
    const graph: ProjectedGraph = buildProjectedGraphFromProject(root)

    const output: string = renderTreeCover(graph, {
        budget: options.budget,
        selected: options.selectedIds ? new Set(options.selectedIds) : undefined,
        focusNodeId: options.focusNodeId,
        pinnedFolderIds: options.pinnedFolderIds,
        warn: console.error,
    })

    return {output, format: 'tree-cover'}
}
