import path from 'path'

import {project, type State} from '@vt/graph-state'
import type {EdgeElement, NodeElement} from '@vt/graph-state/contract'

import {deriveTitle} from './primitives'
import type {ViewFormat, ViewGraphResult} from './viewGraph'

type FolderRenderKind = 'folder-note' | 'virtual-folder'

interface ProjectedViewOptions {
    readonly format?: ViewFormat
    readonly showCrossEdges?: boolean
}

interface RenderEntity {
    readonly id: string
    readonly kind: 'file' | FolderRenderKind
    readonly title: string
    readonly folderLabel?: string
    readonly folderNoteTitle?: string
    readonly collapsed: boolean
    readonly selected: boolean
    readonly outgoingIds: readonly string[]
    readonly parent?: string
}

type ChildrenMap = Map<string, string[]>

function canonicalFolderNotePath(folderId: string): string {
    const normalizedFolder: string = folderId.endsWith('/') ? folderId.slice(0, -1) : folderId
    const folderName: string = path.posix.basename(normalizedFolder)
    return path.posix.join(folderId, `${folderName}.md`)
}

function buildChildrenMap(nodes: readonly NodeElement[]): ChildrenMap {
    const children = new Map<string, string[]>()
    for (const node of nodes) {
        if (!node.parent) continue
        const existing: string[] = children.get(node.parent) ?? []
        existing.push(node.id)
        children.set(node.parent, existing)
    }
    for (const [parentId, ids] of children) {
        children.set(parentId, [...ids])
    }
    return children
}

function countDescendants(entityId: string, childrenMap: ChildrenMap): number {
    const stack: string[] = [...(childrenMap.get(entityId) ?? [])]
    let count = 0
    while (stack.length > 0) {
        const next: string = stack.pop()!
        count += 1
        stack.push(...(childrenMap.get(next) ?? []))
    }
    return count
}

function isSelected(node: NodeElement): boolean {
    return node.classes?.includes('selected') ?? false
}

function buildRenderEntity(
    node: NodeElement,
    state: State,
    outgoingIds: readonly string[],
): RenderEntity {
    if (node.kind === 'node') {
        const graphNode = state.graph.nodes[node.id]
        const title: string = graphNode
            ? deriveTitle(graphNode.contentWithoutYamlOrLinks, node.id)
            : node.label ?? path.posix.basename(node.id, '.md')
        return {
            id: node.id,
            kind: 'file',
            title,
            collapsed: false,
            selected: isSelected(node),
            outgoingIds,
            ...(node.parent ? {parent: node.parent} : {}),
        }
    }

    const notePath: string = canonicalFolderNotePath(node.id)
    const folderNoteNode = state.graph.nodes[notePath]
    const folderLabel: string = node.label ?? path.posix.basename(node.id.slice(0, -1))
    const folderNoteTitle: string | undefined = folderNoteNode
        ? deriveTitle(folderNoteNode.contentWithoutYamlOrLinks, notePath)
        : undefined

    return {
        id: node.id,
        kind: folderNoteNode ? 'folder-note' : 'virtual-folder',
        title: folderLabel,
        folderLabel,
        ...(folderNoteTitle ? {folderNoteTitle} : {}),
        collapsed: node.kind === 'folder-collapsed',
        selected: isSelected(node),
        outgoingIds,
        ...(node.parent ? {parent: node.parent} : {}),
    }
}

function sortIds(
    ids: readonly string[],
    entityById: ReadonlyMap<string, RenderEntity>,
): string[] {
    return [...ids].sort((left, right) => {
        const leftEntity: RenderEntity | undefined = entityById.get(left)
        const rightEntity: RenderEntity | undefined = entityById.get(right)
        const leftFolder: boolean = leftEntity ? leftEntity.kind !== 'file' : false
        const rightFolder: boolean = rightEntity ? rightEntity.kind !== 'file' : false
        if (leftFolder !== rightFolder) return leftFolder ? -1 : 1
        const leftLabel: string = leftEntity?.kind === 'file'
            ? leftEntity.title
            : `${leftEntity?.folderLabel ?? leftEntity?.title ?? left}`
        const rightLabel: string = rightEntity?.kind === 'file'
            ? rightEntity.title
            : `${rightEntity?.folderLabel ?? rightEntity?.title ?? right}`
        return leftLabel.localeCompare(rightLabel)
    })
}

function renderFolderLabel(
    entity: RenderEntity,
    descendantCount: number,
    outgoingCount: number,
): string {
    const prefix: string = entity.selected ? '★ ' : ''
    const folderName: string = `${entity.folderLabel ?? entity.title}/`
    if (entity.kind === 'folder-note') {
        const folderLine: string = `${prefix}▣ ${folderName}${entity.folderNoteTitle ? `  — ${entity.folderNoteTitle}` : ''}`
        return entity.collapsed
            ? `${folderLine} [collapsed ⊟ ${descendantCount} descendants, ${outgoingCount} outgoing]`
            : folderLine
    }

    const folderLine: string = `${prefix}▢ ${folderName}`
    return entity.collapsed
        ? `${folderLine} [collapsed ⊟ ${descendantCount} descendants, ${outgoingCount} outgoing]`
        : folderLine
}

function renderAscii(
    roots: readonly string[],
    childrenMap: ChildrenMap,
    entityById: ReadonlyMap<string, RenderEntity>,
    crossLinks: readonly string[],
    descendantCountById: ReadonlyMap<string, number>,
    outgoingCountById: ReadonlyMap<string, number>,
    showCrossEdges: boolean,
): string {
    const lines: string[] = []

    const renderEntry = (id: string, prefix: string, isLast: boolean, isRoot: boolean): void => {
        const entity = entityById.get(id)
        if (!entity) return
        const branch: string = isRoot ? '' : isLast ? '└── ' : '├── '
        const childPrefix: string = isRoot ? '' : prefix + (isLast ? '    ' : '│   ')

        if (entity.kind === 'file') {
            const selectionPrefix: string = entity.selected ? '★ ' : ''
            lines.push(`${prefix}${branch}${selectionPrefix}· ${entity.title}`)
            if (showCrossEdges) {
                for (const targetId of entity.outgoingIds) {
                    if (targetId === entity.id) continue
                    const target = entityById.get(targetId)
                    const targetTitle: string = !target
                        ? targetId
                        : target.kind === 'file'
                            ? target.title
                            : `${target.folderLabel ?? target.title}/`
                    lines.push(`${childPrefix}    ⇢ ${targetTitle}`)
                }
            }
        } else {
            const descendantCount: number = descendantCountById.get(entity.id) ?? 0
            const outgoingCount: number = outgoingCountById.get(entity.id) ?? 0
            lines.push(`${prefix}${branch}${renderFolderLabel(entity, descendantCount, outgoingCount)}`)
        }

        if (entity.collapsed) return

        const children: string[] = sortIds(childrenMap.get(id) ?? [], entityById)
        children.forEach((childId, index) => {
            renderEntry(childId, childPrefix, index === children.length - 1, false)
        })
    }

    roots.forEach((rootId, index) => {
        renderEntry(rootId, '', index === roots.length - 1, true)
    })

    const selectedPresent: boolean = [...entityById.values()].some((entity) => entity.selected)
    const legendBase: string = selectedPresent
        ? 'Legend: ★ selected   ▣ folder (with folder note)   ▢ virtual folder   · file'
        : 'Legend: ▣ folder (with folder note)   ▢ virtual folder   · file'

    return [
        ...lines,
        '',
        '[Cross-Links]',
        ...crossLinks,
        '',
        `${legendBase}   ⇢ wikilink`,
    ].join('\n')
}

function escapeMermaid(text: string): string {
    return text.replace(/"/g, '\\"').replace(/[\[\]]/g, ' ')
}

function renderMermaid(
    roots: readonly string[],
    childrenMap: ChildrenMap,
    entityById: ReadonlyMap<string, RenderEntity>,
    edges: readonly EdgeElement[],
    descendantCountById: ReadonlyMap<string, number>,
    outgoingCountById: ReadonlyMap<string, number>,
): string {
    const lines: string[] = ['graph LR']
    const idMap: Map<string, string> = new Map()
    let counter = 0
    const safeId = (id: string): string => {
        const existing: string | undefined = idMap.get(id)
        if (existing) return existing
        const next: string = `n${counter++}`
        idMap.set(id, next)
        return next
    }

    const renderNode = (id: string, depth: number): void => {
        const entity = entityById.get(id)
        if (!entity) return
        const indent: string = '  '.repeat(depth + 1)

        if (entity.kind !== 'file' && entity.collapsed) {
            const descendantCount: number = descendantCountById.get(entity.id) ?? 0
            const outgoingCount: number = outgoingCountById.get(entity.id) ?? 0
            const label: string = `📁 ${renderFolderLabel(entity, descendantCount, outgoingCount)}`
            lines.push(`${indent}${safeId(id)}["${escapeMermaid(label)}"]`)
            return
        }

        if (entity.kind === 'file') {
            lines.push(`${indent}${safeId(id)}["${escapeMermaid(entity.title)}"]`)
            return
        }

        const folderLabel: string = entity.kind === 'folder-note'
            ? `${entity.folderLabel ?? entity.title}/  — ${entity.folderNoteTitle ?? entity.title}`
            : `${entity.folderLabel ?? entity.title}/`
        lines.push(`${indent}subgraph ${safeId(id)}["📁 ${escapeMermaid(folderLabel)}"]`)
        const children: string[] = sortIds(childrenMap.get(id) ?? [], entityById)
        for (const childId of children) {
            renderNode(childId, depth + 1)
        }
        lines.push(`${indent}end`)
    }

    for (const rootId of roots) {
        renderNode(rootId, 0)
    }

    for (const edge of edges) {
        if (!entityById.has(edge.source) || !entityById.has(edge.target)) continue
        lines.push(`  ${safeId(edge.source)} -.-> ${safeId(edge.target)}`)
    }

    lines.push('  classDef folderNote fill:#e8f0ff,stroke:#3060c0,stroke-width:2px')
    lines.push('  classDef virtualFolder fill:#f5f5f5,stroke:#888,stroke-dasharray: 4 2')
    lines.push('  classDef collapsedFolder fill:#fff3cd,stroke:#856404,stroke-width:2px')
    lines.push('  classDef file fill:#ffffff,stroke:#444')
    lines.push('  classDef selected stroke:#f93,stroke-width:3px,color:#222')

    for (const [id, entity] of entityById) {
        const baseClass: string = entity.kind === 'file'
            ? 'file'
            : entity.collapsed
                ? 'collapsedFolder'
                : entity.kind === 'folder-note'
                    ? 'folderNote'
                    : 'virtualFolder'
        lines.push(`  class ${safeId(id)} ${baseClass}`)
        if (entity.selected) {
            lines.push(`  class ${safeId(id)} selected`)
        }
    }

    return lines.join('\n')
}

export function renderProjectedLiveView(
    state: State,
    options: ProjectedViewOptions = {},
): ViewGraphResult {
    const format: ViewFormat = options.format ?? 'ascii'
    const showCrossEdges: boolean = options.showCrossEdges ?? true
    const visibleSpec = project(state)
    const uncollapsedSpec = project({...state, collapseSet: new Set()})

    if (visibleSpec.nodes.length === 0) {
        return {format, output: '(no projected nodes in live state)', nodeCount: 0, folderNodeCount: 0, fileNodeCount: 0, virtualFolderCount: 0}
    }

    const outgoingById: Map<string, string[]> = new Map()
    const outgoingCountById: Map<string, number> = new Map()
    for (const edge of visibleSpec.edges) {
        const existing: string[] = outgoingById.get(edge.source) ?? []
        existing.push(edge.target)
        outgoingById.set(edge.source, existing)
        outgoingCountById.set(edge.source, (outgoingCountById.get(edge.source) ?? 0) + 1)
    }

    const entityEntries: Array<readonly [string, RenderEntity]> = visibleSpec.nodes.map((node) => [
        node.id,
        buildRenderEntity(node, state, outgoingById.get(node.id) ?? []),
    ] as const)
    const entityById: Map<string, RenderEntity> = new Map(entityEntries)

    const visibleChildrenMap: ChildrenMap = buildChildrenMap(visibleSpec.nodes)
    const fullChildrenMap: ChildrenMap = buildChildrenMap(uncollapsedSpec.nodes)
    const descendantCountById: Map<string, number> = new Map(
        visibleSpec.nodes
            .filter((node) => node.kind === 'folder-collapsed')
            .map((node) => [node.id, countDescendants(node.id, fullChildrenMap)] as const),
    )

    const roots: string[] = sortIds(
        visibleSpec.nodes.filter((node) => !node.parent).map((node) => node.id),
        entityById,
    )
    const crossLinks: string[] = visibleSpec.edges
        .filter((edge) => entityById.has(edge.source) && entityById.has(edge.target))
        .map((edge) => `${edge.source} -> ${edge.target}`)
        .sort((left, right) => left.localeCompare(right))

    const output: string = format === 'mermaid'
        ? renderMermaid(roots, visibleChildrenMap, entityById, visibleSpec.edges, descendantCountById, outgoingCountById)
        : renderAscii(roots, visibleChildrenMap, entityById, crossLinks, descendantCountById, outgoingCountById, showCrossEdges)

    const folderEntities: readonly RenderEntity[] = [...entityById.values()].filter((entity) => entity.kind !== 'file')
    const folderNodeCount: number = folderEntities.filter((entity) => entity.kind === 'folder-note').length
    const virtualFolderCount: number = folderEntities.filter((entity) => entity.kind === 'virtual-folder').length
    const fileNodeCount: number = [...entityById.values()].filter((entity) => entity.kind === 'file').length

    return {
        format,
        output,
        nodeCount: folderNodeCount + fileNodeCount,
        folderNodeCount,
        fileNodeCount,
        virtualFolderCount,
    }
}
