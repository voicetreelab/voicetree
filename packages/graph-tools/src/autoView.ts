import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Graph, GraphNode} from '@vt/graph-model'
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
import {
    computeArboricity,
    deriveTitle,
    relId,
    type DirectedEdge,
    type JsonState,
} from '../scripts/L3-BF-192-tree-cover-render'
import {
    buildAutoHeader,
    buildAutoFooter,
    renderTreeCoverBody,
    buildClusterDisplayLabelMap,
    ancestorFolders,
    type ClusterDisplayLabelMap,
    type AutoHeaderOptions,
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

interface MappableEntry {
    readonly id: string
    readonly content: string | undefined
    readonly outgoingEdges: readonly {targetId: string}[]
    readonly kind?: 'file' | 'folder'
}

function mapEntriesToAutoViewGraph(entries: readonly MappableEntry[], rootPath: string): AutoViewGraph {
    const nodes: AutoViewNode[] = []
    const nodeById = new Map<string, AutoViewNode>()
    const edges: DirectedEdge[] = []

    for (const entry of entries) {
        const {id} = entry
        const relPath: string = relId(id, rootPath)
        const basename: string = path.posix.basename(relPath)
        const folderPathRaw: string = path.posix.dirname(relPath)
        const folderPath: string = folderPathRaw === '.' ? '' : folderPathRaw
        const title: string = deriveTitle(entry.content, path.basename(id, '.md'))
        const outgoingIds: readonly string[] = entry.outgoingEdges
            .map(edge => edge.targetId)
            .filter(targetId => targetId !== id)
        const autoNode: AutoViewNode = entry.kind !== undefined
            ? {id, title, relPath, folderPath, outgoingIds, basename, kind: entry.kind}
            : {id, title, relPath, folderPath, outgoingIds, basename}
        nodes.push(autoNode)
        nodeById.set(id, autoNode)
        outgoingIds.forEach(targetId => edges.push({src: id, tgt: targetId}))
    }

    const cover = computeArboricity(nodes.length, edges)
    return {
        rootPath,
        rootName: path.basename(rootPath),
        nodes,
        nodeById,
        edges,
        forests: cover.forests,
        arboricity: cover.arboricityUpperBound,
    }
}

export function buildAutoViewGraph(root: string): AutoViewGraph {
    const state = buildJsonStateFromVault(root)
    const entries: MappableEntry[] = Object.entries(state.graph.nodes).map(([id, node]) => ({
        id,
        content: node.contentWithoutYamlOrLinks,
        outgoingEdges: node.outgoingEdges,
    }))
    return mapEntriesToAutoViewGraph(entries, root)
}

export function buildAutoViewGraphFromState(graphState: Graph, rootPath: string): AutoViewGraph {
    const baseEntries: MappableEntry[] = Object.entries(graphState.nodes).map(([id, node]) => ({
        id,
        content: node.contentWithoutYamlOrLinks,
        outgoingEdges: node.outgoingEdges,
        kind: node.kind === 'folder' ? 'folder' as const : 'file' as const,
    }))

    const existingIds = new Set(baseEntries.map(e => e.id))
    const folderPaths = new Set<string>()
    for (const entry of baseEntries) {
        if (entry.kind !== 'folder') {
            const folderPathRaw = path.posix.dirname(relId(entry.id, rootPath))
            const folderPath = folderPathRaw === '.' ? '' : folderPathRaw
            if (folderPath.length > 0) {
                for (const folder of ancestorFolders(folderPath)) {
                    folderPaths.add(folder)
                }
            }
        }
    }
    const syntheticFolderEntries: MappableEntry[] = []
    for (const fp of folderPaths) {
        const folderId = path.join(rootPath, fp)
        if (!existingIds.has(folderId)) {
            syntheticFolderEntries.push({id: folderId, content: '', outgoingEdges: [], kind: 'folder'})
        }
    }

    return mapEntriesToAutoViewGraph([...baseEntries, ...syntheticFolderEntries], rootPath)
}

export interface RenderTreeCoverOptions {
    readonly collapsed?: ReadonlySet<string>
    readonly selected?: ReadonlySet<string>
    readonly budget?: number
    readonly title?: string
    readonly focusNodeId?: string
    readonly pinnedFolderIds?: readonly string[]
}

export function renderTreeCover(graph: AutoViewGraph, opts?: RenderTreeCoverOptions): string {
    if (graph.nodes.length === 0) {
        return ''
    }

    const budget: number = Math.max(1, Math.trunc(opts?.budget ?? DEFAULT_BUDGET))
    const requestedPinnedIds: readonly string[] = opts?.pinnedFolderIds ?? []
    const pinnedClusters: readonly CollapseCluster[] = buildPinnedClusters(graph, requestedPinnedIds)
    const pinnedNodeIds = new Set<string>(pinnedClusters.flatMap(cluster => cluster.nodeIds))
    const remainingNodes: readonly AutoViewNode[] = graph.nodes.filter(node => !pinnedNodeIds.has(node.id))
    const remainingBudget: number = budget - pinnedClusters.length
    const selectedIds: readonly string[] | undefined = opts?.selected ? [...opts.selected] : undefined
    const autoClusters: readonly CollapseCluster[] =
        remainingBudget <= 0
            ? []
            : findCollapseBoundary(
                  {rootName: graph.rootName, nodes: remainingNodes},
                  remainingBudget,
                  {
                      selectedIds,
                      focusNodeId: opts?.focusNodeId,
                  },
              )
    const clusters: readonly CollapseCluster[] = [...pinnedClusters, ...autoClusters]
    const displayLabelByClusterId: ClusterDisplayLabelMap = buildClusterDisplayLabelMap(clusters)
    const visibleEntityCount: number = countVisibleEntities(graph.nodes.length, clusters)
    const userCollapsedClusterIds: ReadonlySet<string> = buildUserCollapsedClusterIds(graph, clusters, opts?.collapsed)
    const body: string = renderTreeCoverBody(graph, clusters, displayLabelByClusterId, opts?.selected, userCollapsedClusterIds)
    const header: string = buildAutoHeader(graph, clusters, budget, visibleEntityCount, {
        pinningRequested: requestedPinnedIds.length > 0,
        pinnedClusterCount: pinnedClusters.length,
        autoClusterCount: autoClusters.length,
    }, displayLabelByClusterId, userCollapsedClusterIds)
    const footer: string = buildAutoFooter(clusters)

    const folderName: string = path.basename(graph.rootPath)
    const viewApplied: boolean = (opts?.collapsed !== undefined && opts.collapsed.size > 0) || (opts?.selected !== undefined && opts.selected.size > 0)
    const structureHeader: string = `═══ STRUCTURE ${folderName}${viewApplied ? ' (view applied)' : ''} ═══`

    return footer.length > 0
        ? `${structureHeader}\n${header}\n${body}\n${footer}`
        : `${structureHeader}\n${header}\n${body}`
}

function buildUserCollapsedClusterIds(
    graph: AutoViewGraph,
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
    vaultPath: string,
    options: AutoViewOptions = {},
): {output: string; format: string} {
    const root: string = path.resolve(vaultPath)
    const graph: AutoViewGraph = buildAutoViewGraph(root)

    const output: string = renderTreeCover(graph, {
        budget: options.budget,
        selected: options.selectedIds ? new Set(options.selectedIds) : undefined,
        focusNodeId: options.focusNodeId,
        pinnedFolderIds: options.pinnedFolderIds,
    })

    return {output, format: 'tree-cover'}
}
