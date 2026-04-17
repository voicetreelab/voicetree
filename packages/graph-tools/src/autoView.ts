import * as fs from 'node:fs'
import * as path from 'node:path'
import {
    scanMarkdownFiles, getNodeId, extractLinks,
    buildUniqueBasenameMap, resolveLinkTarget, type StructureNode,
} from './primitives'
import {computeMetricsFromVault} from './graphMetrics'
import {selectFormat, buildAutoHeader} from './selectFormat'
import {renderGraphView} from './viewGraph'
import {
    computeArboricity, buildFolderSpine, renderSpine, renderCoverForest,
    deriveTitle, type DirectedEdge, type JsonState,
} from '../scripts/L3-BF-192-tree-cover-render'
import {buildRecursiveAscii} from '../scripts/L3-BF-194-recursive-ascii'

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
            if (target && target !== id) outgoingEdges.push({targetId: path.join(root, target + '.md')})
        }
        nodes[absPath] = {absoluteFilePathIsID: absPath, contentWithoutYamlOrLinks: content, outgoingEdges}
    }
    return {graph: {nodes}}
}

export function renderAutoView(vaultPath: string): {output: string; format: string} {
    const root = path.resolve(vaultPath)
    const metrics = computeMetricsFromVault(root)
    const decision = selectFormat(metrics)
    const {format} = decision

    let body: string
    if (format === 'tree-cover') {
        const state = buildJsonStateFromVault(root)
        const titleOf = new Map<string, string>()
        const edges: DirectedEdge[] = []
        for (const [id, node] of Object.entries(state.graph.nodes)) {
            titleOf.set(id, deriveTitle(node.contentWithoutYamlOrLinks, path.basename(id, '.md')))
            for (const e of node.outgoingEdges) {
                if (e.targetId !== id) edges.push({src: id, tgt: e.targetId})
            }
        }
        const cover = computeArboricity(Object.keys(state.graph.nodes).length, edges)
        const spineText = renderSpine(buildFolderSpine(state, root), root)
        const coverTexts = cover.forests.map((f, i) => renderCoverForest(i + 1, f, titleOf, root))
        body = [
            '═══ SPINE (folder hierarchy, no content edges) ═══',
            spineText, '',
            ...coverTexts.flatMap(t => [t, '']),
        ].join('\n')
    } else if (format === 'ascii-lossy') {
        body = renderGraphView(root, {format: 'ascii'}).output
    } else if (format === 'recursive-ascii') {
        const state = buildJsonStateFromVault(root)
        body = buildRecursiveAscii(state, root, {maxInlineEdges: 5, maxInlineNodes: Infinity, maxDepth: 3}).text
    } else if (format === 'mermaid') {
        body = renderGraphView(root, {format: 'mermaid'}).output
    } else {
        // edgelist: JSON with _meta field (header embedded in the data, not as comment)
        const edgeList: {src: string; tgt: string}[] = []
        const mdFiles = scanMarkdownFiles(root)
        const structureNodes = new Map<string, StructureNode>(
            mdFiles.map(abs => { const id = getNodeId(root, abs); return [id, {id, title: id, outgoingIds: []}] })
        )
        const uniqueBasenames = buildUniqueBasenameMap(structureNodes)
        for (const absPath of mdFiles) {
            const id = getNodeId(root, absPath)
            const content = fs.readFileSync(absPath, 'utf-8')
            for (const link of extractLinks(content)) {
                const target = resolveLinkTarget(link, id, structureNodes, uniqueBasenames)
                if (target && target !== id) edgeList.push({src: id, tgt: target})
            }
        }
        const {arboricity, planar, sccCount, kCore, nodeCount, edgeCount} = decision.metrics
        return {
            output: JSON.stringify({
                _meta: {
                    format: 'edgelist (auto-selected)',
                    metrics: {N: nodeCount, E: edgeCount, arboricity, planar, sccCount, kCore},
                    rationale: decision.rationale,
                },
                edges: edgeList,
            }, null, 2),
            format,
        }
    }

    const commentChar = format === 'mermaid' ? '%%' : '#'
    const header = buildAutoHeader(decision, commentChar)
    return {output: `${header}\n${body}`, format}
}
