/**
 * vt-graph view — agent-facing visualization of a markdown graph.
 *
 * Distinguishes folder nodes (compound / hypergraph) from file nodes.
 *
 * Folder identity model (BF-108): a folder node = a directory + optional folder
 * note (`foldername/foldername.md`). A folder note IS the folder's identity file
 * and is drawn AS the folder, not inside it.
 *
 * ASCII glyphs:
 *   ▣ name/   folder with folder note (compound + identity file)
 *   ▢ name/   virtual folder — directory only, no folder note
 *   · name    file node
 *   → [[t]]   cross-boundary wikilink (target outside rendered subtree)
 */

import {readFileSync} from 'fs'
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
import {buildContainmentTree, buildFolderIndexMap, type ContainmentTree} from './lintContainment'
import {
    buildCollapsedMap,
    collectCollapsedDescendants,
    isVirtualFolder,
    VIRTUAL_FOLDER_PREFIX,
    type CollapsedInfo,
} from './folderCollapse'
import {resolveSelectedIds} from './viewGraphSelection'

export type ViewFormat = 'ascii' | 'mermaid'

export interface ViewGraphOptions {
    readonly format?: ViewFormat
    readonly showCrossEdges?: boolean
    /** Relative folder paths inside the rendered root to collapse (e.g. "tasks", "knowledge/subfolder"). Repeatable. */
    readonly collapsedFolders?: readonly string[]
    /** Node ids to visually mark as selected. Accepts absolute file paths, relative node ids, or unique basenames. */
    readonly selectedIds?: readonly string[]
}

export interface ViewGraphResult {
    readonly format: ViewFormat
    readonly output: string
    readonly nodeCount: number
    readonly folderNodeCount: number
    readonly fileNodeCount: number
    readonly virtualFolderCount: number
}

interface ViewNode {
    readonly id: string
    readonly title: string
    outgoingIds: readonly string[]
    unresolvedWikilinks: readonly string[]
    readonly absolutePath: string
}

export function renderGraphView(folderPath: string, options: ViewGraphOptions = {}): ViewGraphResult {
    const format: ViewFormat = options.format ?? 'ascii'
    const showCrossEdges: boolean = options.showCrossEdges ?? true

    const mdFiles: readonly string[] = scanMarkdownFiles(folderPath)
    const root: string = path.resolve(folderPath)

    if (mdFiles.length === 0) {
        return {format, output: '', nodeCount: 0, folderNodeCount: 0, fileNodeCount: 0, virtualFolderCount: 0}
    }

    const nodes: ViewNode[] = buildViewNodes(mdFiles, root)
    const nodeIds: string[] = nodes.map(n => n.id)
    const nodeContents: Map<string, string> = new Map(nodes.map(n => [n.id, readFileSync(n.absolutePath, 'utf-8')]))
    const folderIndexMap: Map<string, string> = buildFolderIndexMap(nodeIds)
    const containment: ContainmentTree = buildContainmentTree(nodeIds, nodeContents, folderIndexMap)

    const counts = countNodeKinds(containment, folderIndexMap, new Set(nodeIds))
    const nodeById: Map<string, ViewNode> = new Map(nodes.map(n => [n.id, n]))
    const selectedIds: ReadonlySet<string> = resolveSelectedIds(options.selectedIds ?? [], root, nodeById)

    const collapsedMap: ReadonlyMap<string, CollapsedInfo> = buildCollapsedMap(
        options.collapsedFolders ?? [],
        folderIndexMap,
        containment,
        nodeById,
    )

    const output: string = format === 'mermaid'
        ? renderMermaid(containment, folderIndexMap, nodeById, collapsedMap, selectedIds)
        : renderAscii(containment, folderIndexMap, nodeById, showCrossEdges, collapsedMap, selectedIds)

    return {
        format,
        output,
        nodeCount: nodes.length,
        folderNodeCount: counts.folderNoteCount,
        fileNodeCount: counts.fileCount,
        virtualFolderCount: counts.virtualFolderCount,
    }
}

function buildViewNodes(files: readonly string[], rootPath: string): ViewNode[] {
    const records: {absolutePath: string; content: string}[] = files.map(p => ({
        absolutePath: p,
        content: readFileSync(p, 'utf-8'),
    }))
    const nodesById: Map<string, ViewNode> = new Map(
        records.map(({absolutePath, content}) => {
            const id: string = getNodeId(rootPath, absolutePath)
            return [id, {id, title: deriveTitle(content, absolutePath), outgoingIds: [], unresolvedWikilinks: [], absolutePath}]
        })
    )
    const structureNodesById: Map<string, StructureNode> = new Map(
        [...nodesById.values()].map(node => [node.id, {id: node.id, title: node.title, outgoingIds: []}]),
    )
    const uniqueBasenames: Map<string, string> = buildUniqueBasenameMap(structureNodesById)

    for (const {absolutePath, content} of records) {
        const id: string = getNodeId(rootPath, absolutePath)
        const node: ViewNode | undefined = nodesById.get(id)
        if (!node) continue
        const outgoing = new Set<string>()
        const unresolved = new Set<string>()
        for (const link of extractLinks(content)) {
            const target: string | undefined = resolveLinkTarget(link, id, structureNodesById, uniqueBasenames)
            if (target === undefined) {
                unresolved.add(link)
            } else {
                outgoing.add(target)
            }
        }
        node.outgoingIds = [...outgoing]
        node.unresolvedWikilinks = [...unresolved]
    }

    return [...nodesById.values()]
}

function isFolderNote(id: string, folderIndexMap: ReadonlyMap<string, string>): boolean {
    const dir: string = path.posix.dirname(id)
    return dir !== '.' && folderIndexMap.get(dir) === id
}

function virtualFolderTitle(id: string): string {
    const folderPath: string = id.slice(VIRTUAL_FOLDER_PREFIX.length)
    return path.posix.basename(folderPath) + '/'
}

function folderNoteTitle(node: ViewNode): string {
    return path.posix.basename(path.posix.dirname(node.id)) + '/'
}

function fileNodeLabel(node: ViewNode): string {
    return node.title
}

function countNodeKinds(
    containment: ContainmentTree,
    folderIndexMap: ReadonlyMap<string, string>,
    realNodeIds: ReadonlySet<string>,
): {folderNoteCount: number; virtualFolderCount: number; fileCount: number} {
    let folderNoteCount = 0
    let virtualFolderCount = 0
    let fileCount = 0
    for (const id of containment.parentOf.keys()) {
        if (isVirtualFolder(id)) {
            virtualFolderCount += 1
            continue
        }
        if (!realNodeIds.has(id)) continue
        if (isFolderNote(id, folderIndexMap)) {
            folderNoteCount += 1
        } else {
            fileCount += 1
        }
    }
    return {folderNoteCount, virtualFolderCount, fileCount}
}

// ── ASCII renderer ─────────────────────────────────────────────────────────

function renderAscii(
    containment: ContainmentTree,
    folderIndexMap: ReadonlyMap<string, string>,
    nodeById: ReadonlyMap<string, ViewNode>,
    showCrossEdges: boolean,
    collapsedMap: ReadonlyMap<string, CollapsedInfo>,
    selectedIds: ReadonlySet<string>,
): string {
    const roots: string[] = sortIds(
        [...containment.parentOf.entries()]
            .filter(([, parent]) => parent === null)
            .map(([id]) => id),
        nodeById,
        folderIndexMap,
    )
    const lines: string[] = []
    roots.forEach((id, i) => {
        const last: boolean = i === roots.length - 1
        renderAsciiEntry(id, '', last, true, containment, folderIndexMap, nodeById, lines, showCrossEdges, collapsedMap, selectedIds)
    })
    const crossLinks: string[] = buildCrossLinks(containment, nodeById, collapsedMap)
    const legendBase: string = selectedIds.size > 0
        ? 'Legend: ★ selected   ▣ folder (with folder note)   ▢ virtual folder   · file'
        : 'Legend: ▣ folder (with folder note)   ▢ virtual folder   · file'
    const legend: string[] = [
        '',
        showCrossEdges ? `${legendBase}   ⇢ wikilink` : legendBase,
    ]
    return [...lines, '', '[Cross-Links]', ...crossLinks, ...legend].join('\n')
}

function buildCrossLinks(
    containment: ContainmentTree,
    nodeById: ReadonlyMap<string, ViewNode>,
    collapsedMap: ReadonlyMap<string, CollapsedInfo>,
): string[] {
    const crossLinks: string[] = []
    const collapsedDescendants: ReadonlySet<string> = collectCollapsedDescendants(collapsedMap, containment)

    for (const [id, node] of nodeById) {
        if (collapsedDescendants.has(id)) continue
        for (const target of node.outgoingIds) {
            if (target === id || collapsedDescendants.has(target) || !nodeById.has(target)) continue
            crossLinks.push(`${id} -> ${target}`)
        }
        for (const unresolved of node.unresolvedWikilinks) {
            crossLinks.push(`${id} -> ?${unresolved}`)
        }
    }

    for (const [entityId, info] of collapsedMap) {
        if (collapsedDescendants.has(entityId)) continue
        for (const target of info.externalTargets) {
            if (!nodeById.has(target) || collapsedDescendants.has(target)) continue
            crossLinks.push(`${entityId} -> ${target}`)
        }
    }

    return crossLinks.sort((left, right) => left.localeCompare(right))
}

function renderAsciiEntry(
    id: string,
    prefix: string,
    isLast: boolean,
    isRoot: boolean,
    containment: ContainmentTree,
    folderIndexMap: ReadonlyMap<string, string>,
    nodeById: ReadonlyMap<string, ViewNode>,
    out: string[],
    showCrossEdges: boolean,
    collapsedMap: ReadonlyMap<string, CollapsedInfo>,
    selectedIds: ReadonlySet<string>,
): void {
    const branch: string = isRoot ? '' : isLast ? '└── ' : '├── '
    const childPrefix: string = isRoot ? '' : prefix + (isLast ? '    ' : '│   ')
    const collapsedInfo: CollapsedInfo | undefined = collapsedMap.get(id)
    const selectionPrefix: string = selectedIds.has(id) ? '★ ' : ''

    if (isVirtualFolder(id)) {
        if (collapsedInfo) {
            out.push(`${prefix}${branch}▢ ${virtualFolderTitle(id)} [collapsed ⊟ ${collapsedInfo.descendantCount} descendants, ${collapsedInfo.externalOutgoingCount} outgoing]`)
            return
        }
        out.push(`${prefix}${branch}▢ ${virtualFolderTitle(id)}`)
    } else {
        const node: ViewNode | undefined = nodeById.get(id)
        if (!node) return
        if (isFolderNote(node.id, folderIndexMap)) {
            if (collapsedInfo) {
                out.push(`${prefix}${branch}${selectionPrefix}▣ ${folderNoteTitle(node)}  — ${node.title} [collapsed ⊟ ${collapsedInfo.descendantCount} descendants, ${collapsedInfo.externalOutgoingCount} outgoing]`)
                return
            }
            out.push(`${prefix}${branch}${selectionPrefix}▣ ${folderNoteTitle(node)}  — ${node.title}`)
        } else {
            out.push(`${prefix}${branch}${selectionPrefix}· ${fileNodeLabel(node)}`)
            if (showCrossEdges) {
                for (const target of node.outgoingIds) {
                    if (target === node.id) continue
                    const targetTitle: string = nodeById.get(target)?.title ?? target
                    out.push(`${childPrefix}    ⇢ ${targetTitle}`)
                }
            }
        }
    }

    if (collapsedInfo) return

    const children: string[] = sortIds(containment.childrenOf.get(id) ?? [], nodeById, folderIndexMap)
    children.forEach((childId, i) => {
        renderAsciiEntry(
            childId, childPrefix, i === children.length - 1, false,
            containment, folderIndexMap, nodeById, out, showCrossEdges, collapsedMap, selectedIds,
        )
    })
}

function sortIds(
    ids: readonly string[],
    nodeById: ReadonlyMap<string, ViewNode>,
    folderIndexMap: ReadonlyMap<string, string>,
): string[] {
    return [...ids].sort((a, b) => {
        const aFolder: boolean = isVirtualFolder(a) || isFolderNote(a, folderIndexMap)
        const bFolder: boolean = isVirtualFolder(b) || isFolderNote(b, folderIndexMap)
        if (aFolder !== bFolder) return aFolder ? -1 : 1 // folders first
        const aLabel: string = isVirtualFolder(a) ? virtualFolderTitle(a) : nodeById.get(a)?.title ?? a
        const bLabel: string = isVirtualFolder(b) ? virtualFolderTitle(b) : nodeById.get(b)?.title ?? b
        return aLabel.localeCompare(bLabel)
    })
}

// ── Mermaid renderer ───────────────────────────────────────────────────────

function renderMermaid(
    containment: ContainmentTree,
    folderIndexMap: ReadonlyMap<string, string>,
    nodeById: ReadonlyMap<string, ViewNode>,
    collapsedMap: ReadonlyMap<string, CollapsedInfo>,
    selectedIds: ReadonlySet<string>,
): string {
    const lines: string[] = ['graph LR']
    const idMap: Map<string, string> = new Map()
    let counter: number = 0
    const safeId = (id: string): string => {
        const existing: string | undefined = idMap.get(id)
        if (existing) return existing
        const next: string = `n${counter++}`
        idMap.set(id, next)
        return next
    }

    const roots: string[] = sortIds(
        [...containment.parentOf.entries()].filter(([, p]) => p === null).map(([id]) => id),
        nodeById,
        folderIndexMap,
    )

    for (const rootId of roots) {
        renderMermaidNode(rootId, 0, containment, folderIndexMap, nodeById, lines, safeId, collapsedMap)
    }

    const allCollapsedDescendants: ReadonlySet<string> = collectCollapsedDescendants(collapsedMap, containment)

    // Edges from wikilinks — skip nodes hidden inside collapsed folders
    for (const [id, node] of nodeById) {
        if (allCollapsedDescendants.has(id)) continue
        for (const target of node.outgoingIds) {
            if (!nodeById.has(target)) continue
            if (allCollapsedDescendants.has(target)) continue
            lines.push(`  ${safeId(id)} -.-> ${safeId(target)}`)
        }
    }

    // Aggregated edges from collapsed folders to their external targets
    for (const [entityId, info] of collapsedMap) {
        if (allCollapsedDescendants.has(entityId)) continue
        for (const target of info.externalTargets) {
            if (nodeById.has(target) && !allCollapsedDescendants.has(target)) {
                lines.push(`  ${safeId(entityId)} -.-> ${safeId(target)}`)
            }
        }
    }

    // Style folders distinctly
    lines.push('  classDef folderNote fill:#e8f0ff,stroke:#3060c0,stroke-width:2px')
    lines.push('  classDef virtualFolder fill:#f5f5f5,stroke:#888,stroke-dasharray: 4 2')
    lines.push('  classDef collapsedFolder fill:#fff3cd,stroke:#856404,stroke-width:2px')
    lines.push('  classDef file fill:#ffffff,stroke:#444')
    lines.push('  classDef selected stroke:#f93,stroke-width:3px,color:#222')
    for (const [id] of nodeById) {
        if (allCollapsedDescendants.has(id)) continue
        const cls: string = isFolderNote(id, folderIndexMap) ? 'folderNote' : 'file'
        lines.push(`  class ${safeId(id)} ${cls}`)
    }
    for (const entityId of collapsedMap.keys()) {
        if (allCollapsedDescendants.has(entityId)) continue
        lines.push(`  class ${safeId(entityId)} collapsedFolder`)
    }
    for (const id of selectedIds) {
        if (!nodeById.has(id)) continue
        if (allCollapsedDescendants.has(id)) continue
        const mermaidIds: readonly string[] = selectedMermaidIds(id, folderIndexMap, collapsedMap)
        for (const mermaidId of mermaidIds) {
            lines.push(`  class ${safeId(mermaidId)} selected`)
        }
    }

    return lines.join('\n')
}

function selectedMermaidIds(
    id: string,
    folderIndexMap: ReadonlyMap<string, string>,
    collapsedMap: ReadonlyMap<string, CollapsedInfo>,
): readonly string[] {
    if (collapsedMap.has(id)) {
        return [id]
    }
    if (isFolderNote(id, folderIndexMap)) {
        return [id, `${id}__self`]
    }
    return [id]
}

function renderMermaidNode(
    id: string,
    depth: number,
    containment: ContainmentTree,
    folderIndexMap: ReadonlyMap<string, string>,
    nodeById: ReadonlyMap<string, ViewNode>,
    out: string[],
    safeId: (id: string) => string,
    collapsedMap: ReadonlyMap<string, CollapsedInfo>,
): void {
    const indent: string = '  '.repeat(depth + 1)
    const collapsedInfo: CollapsedInfo | undefined = collapsedMap.get(id)

    if (collapsedInfo) {
        const isVF: boolean = isVirtualFolder(id)
        const baseLabel: string = isVF
            ? virtualFolderTitle(id)
            : `${folderNoteTitle(nodeById.get(id)!)}  — ${nodeById.get(id)!.title}`
        const label: string = `📁 ${baseLabel} [⊟ ${collapsedInfo.descendantCount} desc, ${collapsedInfo.externalOutgoingCount} out]`
        out.push(`${indent}${safeId(id)}["${escapeMermaid(label)}"]`)
        return
    }

    const children: string[] = sortIds(containment.childrenOf.get(id) ?? [], nodeById, folderIndexMap)
    const isContainer: boolean = isVirtualFolder(id) || isFolderNote(id, folderIndexMap) || children.length > 0

    if (isContainer && (isVirtualFolder(id) || isFolderNote(id, folderIndexMap))) {
        const label: string = isVirtualFolder(id)
            ? virtualFolderTitle(id)
            : `${folderNoteTitle(nodeById.get(id)!)}  — ${nodeById.get(id)!.title}`
        out.push(`${indent}subgraph ${safeId(id)}["📁 ${escapeMermaid(label)}"]`)
        if (!isVirtualFolder(id)) {
            // Folder note IS a node inside its own subgraph (so edges can attach)
            const node: ViewNode = nodeById.get(id)!
            out.push(`${indent}  ${safeId(id + '__self')}["${escapeMermaid(node.title)}"]`)
        }
        for (const childId of children) {
            renderMermaidNode(childId, depth + 1, containment, folderIndexMap, nodeById, out, safeId, collapsedMap)
        }
        out.push(`${indent}end`)
        return
    }

    if (isVirtualFolder(id)) return // shouldn't reach
    const node: ViewNode | undefined = nodeById.get(id)
    if (!node) return
    out.push(`${indent}${safeId(id)}["${escapeMermaid(node.title)}"]`)
    for (const childId of children) {
        renderMermaidNode(childId, depth, containment, folderIndexMap, nodeById, out, safeId, collapsedMap)
    }
}

function escapeMermaid(s: string): string {
    return s.replace(/"/g, '\\"').replace(/[\[\]]/g, ' ')
}
