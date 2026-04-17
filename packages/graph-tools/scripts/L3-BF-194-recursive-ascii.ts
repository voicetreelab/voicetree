#!/usr/bin/env node --import tsx
import {execFileSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
    computeArboricity,
    deriveTitle,
    lcpOfIds,
    relId,
    type DirectedEdge,
    type JsonNode,
    type JsonState,
} from './L3-BF-192-tree-cover-render'
type RecursiveRenderOptions = {
    readonly maxInlineEdges: number
    readonly maxInlineNodes: number
    readonly maxDepth: number
}
type FileInfo = {
    readonly id: string
    readonly relPath: string
    readonly title: string
    readonly outgoingEdges: JsonNode['outgoingEdges']
}
type FolderStats = {
    readonly nodeIds: readonly string[]
    readonly nodeCount: number
    readonly edgeCount: number
    readonly arboricity: number
}
type FolderNode = {
    readonly name: string
    readonly relPath: string
    readonly files: readonly FileInfo[]
    readonly children: readonly FolderNode[]
    stats: FolderStats
}
type FragmentStats = {
    readonly nodeCount: number
    readonly inlineEdgeCount: number
    readonly footerEdgeCount: number
    readonly arboricity: number
}
type FragmentRender = {
    readonly id: string
    readonly label: string
    readonly rootRelPath: string
    readonly lines: readonly string[]
    readonly footerLines: readonly string[]
    readonly stats: FragmentStats
}
type RecursiveRender = {
    readonly text: string
    readonly fragments: readonly FragmentRender[]
    readonly nodeToFragment: ReadonlyMap<string, string>
}
type ExtractPlan = {
    readonly fragmentOrder: readonly string[]
    readonly extractedFolderToFragment: ReadonlyMap<string, string>
    readonly fragmentRoots: ReadonlyMap<string, FolderNode>
}
const DEFAULTS: RecursiveRenderOptions = {
    maxInlineEdges: 30,
    maxInlineNodes: Number.POSITIVE_INFINITY,
    maxDepth: 3,
}
function parseLimit(raw: string | undefined, fallback: number): number {
    if (!raw) return fallback
    const normalized: string = raw.toLowerCase()
    if (normalized === 'inf' || normalized === 'infinity' || normalized === '∞') return Number.POSITIVE_INFINITY
    const parsed: number = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid limit: ${raw}`)
    return parsed
}
function formatLimit(value: number): string {
    return Number.isFinite(value) ? String(value) : '∞'
}
function loadStateFromRoot(vaultRoot: string): JsonState {
    const tempPath: string = path.join(os.tmpdir(), `bf194-${process.pid}-${Date.now()}.json`)
    try {
        execFileSync('./node_modules/.bin/vt-graph', [
            'state',
            'dump',
            vaultRoot,
            '--no-pretty',
            '--out',
            tempPath,
        ], {stdio: ['ignore', 'ignore', 'inherit']})
        return JSON.parse(fs.readFileSync(tempPath, 'utf8'))
    } finally {
        fs.rmSync(tempPath, {force: true})
    }
}
function sortChildren(children: readonly FolderNode[]): readonly FolderNode[] {
    return [...children].sort((left, right) => left.name.localeCompare(right.name))
}
function sortFiles(files: readonly FileInfo[]): readonly FileInfo[] {
    return [...files].sort((left, right) =>
        left.title.localeCompare(right.title) || left.relPath.localeCompare(right.relPath))
}
function buildFolderTree(state: JsonState, vaultRoot: string): {root: FolderNode; fileById: ReadonlyMap<string, FileInfo>} {
    type MutableFolder = {
        readonly name: string
        readonly relPath: string
        readonly files: FileInfo[]
        readonly childMap: Map<string, MutableFolder>
    }
    const mutableRoot: MutableFolder = {
        name: path.basename(vaultRoot),
        relPath: '',
        files: [],
        childMap: new Map(),
    }
    const fileById: Map<string, FileInfo> = new Map()
    for (const [absId, node] of Object.entries(state.graph.nodes)) {
        const relPath: string = relId(absId, vaultRoot)
        const segments: string[] = relPath.split('/')
        let current: MutableFolder = mutableRoot
        for (let i = 0; i < segments.length - 1; i++) {
            const name: string = segments[i]!
            const childRel: string = current.relPath ? `${current.relPath}/${name}` : name
            if (!current.childMap.has(name)) {
                current.childMap.set(name, {
                    name,
                    relPath: childRel,
                    files: [],
                    childMap: new Map(),
                })
            }
            current = current.childMap.get(name)!
        }
        const title: string = deriveTitle(node.contentWithoutYamlOrLinks, path.basename(absId, '.md'))
        const info: FileInfo = {
            id: absId,
            relPath,
            title,
            outgoingEdges: node.outgoingEdges,
        }
        current.files.push(info)
        fileById.set(absId, info)
    }
    const finalize = (folder: MutableFolder): FolderNode => ({
        name: folder.name,
        relPath: folder.relPath,
        files: sortFiles(folder.files),
        children: sortChildren([...folder.childMap.values()].map(finalize)),
        stats: {nodeIds: [], nodeCount: 0, edgeCount: 0, arboricity: 0},
    })
    return {root: finalize(mutableRoot), fileById}
}
function computeFolderStats(folder: FolderNode, fileById: ReadonlyMap<string, FileInfo>): readonly string[] {
    const nodeIds: string[] = folder.files.map(file => file.id)
    for (const child of folder.children) nodeIds.push(...computeFolderStats(child, fileById))
    const nodeSet: Set<string> = new Set(nodeIds)
    const localEdges: DirectedEdge[] = []
    for (const id of nodeIds) {
        const file: FileInfo | undefined = fileById.get(id)
        if (!file) continue
        for (const edge of file.outgoingEdges) {
            if (edge.targetId === id || !nodeSet.has(edge.targetId)) continue
            localEdges.push({src: id, tgt: edge.targetId, label: edge.label})
        }
    }
    folder.stats = {
        nodeIds,
        nodeCount: nodeIds.length,
        edgeCount: localEdges.length,
        arboricity: nodeIds.length < 2 || localEdges.length === 0
            ? 0
            : computeArboricity(nodeIds.length, localEdges).arboricityUpperBound,
    }
    return nodeIds
}
function shouldExtract(folder: FolderNode, fragmentDepth: number, options: RecursiveRenderOptions): boolean {
    if (fragmentDepth >= options.maxDepth) return false
    if (folder.stats.nodeCount <= 1) return false
    return folder.stats.edgeCount > options.maxInlineEdges || folder.stats.nodeCount > options.maxInlineNodes
}
function planExtractions(root: FolderNode, options: RecursiveRenderOptions): ExtractPlan {
    const fragmentOrder: string[] = ['main']
    const extractedFolderToFragment: Map<string, string> = new Map()
    const fragmentRoots: Map<string, FolderNode> = new Map([['main', root]])
    let nextFragment = 1
    const walk = (folder: FolderNode, fragmentDepth: number): void => {
        for (const child of folder.children) {
            const extracted: boolean = shouldExtract(child, fragmentDepth, options)
            if (extracted) {
                const fragmentId: string = `fragment-${nextFragment++}`
                extractedFolderToFragment.set(child.relPath, fragmentId)
                fragmentRoots.set(fragmentId, child)
                fragmentOrder.push(fragmentId)
                walk(child, fragmentDepth + 1)
                continue
            }
            walk(child, fragmentDepth)
        }
    }

    walk(root, 0)
    return {fragmentOrder, extractedFolderToFragment, fragmentRoots}
}

function assignNodeFragments(
    folder: FolderNode,
    currentFragment: string,
    extractedFolderToFragment: ReadonlyMap<string, string>,
    nodeToFragment: Map<string, string>,
): void {
    const activeFragment: string = folder.relPath ? (extractedFolderToFragment.get(folder.relPath) ?? currentFragment) : currentFragment
    for (const file of folder.files) nodeToFragment.set(file.id, activeFragment)
    for (const child of folder.children) assignNodeFragments(child, activeFragment, extractedFolderToFragment, nodeToFragment)
}

function folderHasVisibleContent(
    folder: FolderNode,
    fragmentId: string,
    extractedFolderToFragment: ReadonlyMap<string, string>,
    nodeToFragment: ReadonlyMap<string, string>,
): boolean {
    if (folder.relPath && (extractedFolderToFragment.get(folder.relPath) ?? fragmentId) !== fragmentId) return false
    if (folder.files.some(file => nodeToFragment.get(file.id) === fragmentId)) return true
    for (const child of folder.children) {
        if (extractedFolderToFragment.get(child.relPath)) return true
        if (folderHasVisibleContent(child, fragmentId, extractedFolderToFragment, nodeToFragment)) return true
    }
    return false
}

function localInlineEdges(
    file: FileInfo,
    fragmentId: string,
    fileById: ReadonlyMap<string, FileInfo>,
    nodeToFragment: ReadonlyMap<string, string>,
    vaultRoot: string,
): readonly string[] {
    const lines: string[] = []
    const localTargets = file.outgoingEdges
        .filter(edge => edge.targetId !== file.id && nodeToFragment.get(edge.targetId) === fragmentId)
        .map(edge => ({
            id: edge.targetId,
            title: fileById.get(edge.targetId)?.title ?? path.basename(edge.targetId, '.md'),
            label: edge.label,
        }))
        .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
    for (const target of localTargets) {
        const labelPart: string = target.label ? ` [${target.label}]` : ''
        lines.push(`⇢ ${target.title} @[${relId(target.id, vaultRoot)}]${labelPart}`)
    }
    return lines
}

function renderFragmentTree(
    folder: FolderNode,
    fragmentId: string,
    indents: readonly boolean[],
    lines: string[],
    extractedFolderToFragment: ReadonlyMap<string, string>,
    nodeToFragment: ReadonlyMap<string, string>,
    fileById: ReadonlyMap<string, FileInfo>,
    vaultRoot: string,
): void {
    const entries: Array<{kind: 'folder'; folder: FolderNode} | {kind: 'file'; file: FileInfo}> = []
    for (const child of folder.children) {
        const extractedFragment: string | undefined = extractedFolderToFragment.get(child.relPath)
        if (extractedFragment && extractedFragment !== fragmentId) {
            entries.push({kind: 'folder', folder: child})
            continue
        }
        if (folderHasVisibleContent(child, fragmentId, extractedFolderToFragment, nodeToFragment)) {
            entries.push({kind: 'folder', folder: child})
        }
    }
    for (const file of folder.files) {
        if (nodeToFragment.get(file.id) === fragmentId) entries.push({kind: 'file', file})
    }

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!
        const isLast: boolean = i === entries.length - 1
        const prefix: string = indents.map(open => open ? '│   ' : '    ').join('') + (isLast ? '└── ' : '├── ')
        if (entry.kind === 'folder') {
            const extractedFragment: string | undefined = extractedFolderToFragment.get(entry.folder.relPath)
            if (extractedFragment && extractedFragment !== fragmentId) {
                const stats: FolderStats = entry.folder.stats
                lines.push(`${prefix}▦ ${entry.folder.name} [${stats.nodeCount} nodes, ${stats.edgeCount} edges, a=${stats.arboricity}] → ${extractedFragment}`)
                continue
            }
            lines.push(`${prefix}▢ ${entry.folder.name}/`)
            renderFragmentTree(
                entry.folder,
                fragmentId,
                [...indents, !isLast],
                lines,
                extractedFolderToFragment,
                nodeToFragment,
                fileById,
                vaultRoot,
            )
            continue
        }
        lines.push(`${prefix}· ${entry.file.title} @[${entry.file.relPath}]`)
        const inlineEdges: readonly string[] = localInlineEdges(entry.file, fragmentId, fileById, nodeToFragment, vaultRoot)
        const childPrefix: string = indents.map(open => open ? '│   ' : '    ').join('') + (isLast ? '    ' : '│   ')
        for (let j = 0; j < inlineEdges.length; j++) {
            const edge: string = inlineEdges[j]!
            const edgeLast: boolean = j === inlineEdges.length - 1
            lines.push(`${childPrefix}${edgeLast ? '└── ' : '├── '}${edge}`)
        }
    }
}

function buildFragmentFooter(
    fragmentId: string,
    nodeIds: readonly string[],
    fileById: ReadonlyMap<string, FileInfo>,
    nodeToFragment: ReadonlyMap<string, string>,
    vaultRoot: string,
): readonly string[] {
    const lines: string[] = []
    const sortedNodeIds: readonly string[] = [...nodeIds].sort((left, right) =>
        (fileById.get(left)?.relPath ?? left).localeCompare(fileById.get(right)?.relPath ?? right))
    for (const id of sortedNodeIds) {
        const file: FileInfo | undefined = fileById.get(id)
        if (!file) continue
        for (const edge of file.outgoingEdges) {
            if (edge.targetId === id) continue
            const targetFragment: string | undefined = nodeToFragment.get(edge.targetId)
            if (targetFragment === fragmentId) continue
            const targetText: string = targetFragment
                ? `${targetFragment}::${relId(edge.targetId, vaultRoot)}`
                : `?${edge.targetId}`
            lines.push(`${file.relPath} -> ${targetText}`)
        }
    }
    return lines.sort((left, right) => left.localeCompare(right))
}

function computeFragmentStats(
    fragmentId: string,
    nodeIds: readonly string[],
    fileById: ReadonlyMap<string, FileInfo>,
    nodeToFragment: ReadonlyMap<string, string>,
): FragmentStats {
    const localEdges: DirectedEdge[] = []
    let footerEdgeCount = 0
    for (const id of nodeIds) {
        const file: FileInfo | undefined = fileById.get(id)
        if (!file) continue
        for (const edge of file.outgoingEdges) {
            if (edge.targetId === id) continue
            if (nodeToFragment.get(edge.targetId) === fragmentId) {
                localEdges.push({src: id, tgt: edge.targetId, label: edge.label})
            } else {
                footerEdgeCount += 1
            }
        }
    }
    return {
        nodeCount: nodeIds.length,
        inlineEdgeCount: localEdges.length,
        footerEdgeCount,
        arboricity: nodeIds.length < 2 || localEdges.length === 0
            ? 0
            : computeArboricity(nodeIds.length, localEdges).arboricityUpperBound,
    }
}

function buildRecursiveAscii(state: JsonState, vaultRoot: string, options: RecursiveRenderOptions): RecursiveRender {
    const {root, fileById} = buildFolderTree(state, vaultRoot)
    computeFolderStats(root, fileById)
    const plan: ExtractPlan = planExtractions(root, options)
    const nodeToFragment: Map<string, string> = new Map()
    assignNodeFragments(root, 'main', plan.extractedFolderToFragment, nodeToFragment)

    const groupedNodes: Map<string, string[]> = new Map(plan.fragmentOrder.map(id => [id, []]))
    for (const [id, fragmentId] of nodeToFragment) groupedNodes.get(fragmentId)?.push(id)
    for (const ids of groupedNodes.values()) ids.sort((left, right) =>
        (fileById.get(left)?.relPath ?? left).localeCompare(fileById.get(right)?.relPath ?? right))

    const fragments: FragmentRender[] = []
    for (const fragmentId of plan.fragmentOrder) {
        const fragmentRoot: FolderNode = plan.fragmentRoots.get(fragmentId)!
        const lines: string[] = [`▢ ${fragmentRoot.name}/`]
        renderFragmentTree(
            fragmentRoot,
            fragmentId,
            [],
            lines,
            plan.extractedFolderToFragment,
            nodeToFragment,
            fileById,
            vaultRoot,
        )
        const nodeIds: readonly string[] = groupedNodes.get(fragmentId) ?? []
        const footerLines: readonly string[] = buildFragmentFooter(fragmentId, nodeIds, fileById, nodeToFragment, vaultRoot)
        fragments.push({
            id: fragmentId,
            label: fragmentId === 'main' ? path.basename(vaultRoot) : (fragmentRoot.relPath || fragmentRoot.name),
            rootRelPath: fragmentRoot.relPath,
            lines,
            footerLines,
            stats: computeFragmentStats(fragmentId, nodeIds, fileById, nodeToFragment),
        })
    }

    const out: string[] = []
    out.push('═══ L3-BF-194 recursive ASCII ═══')
    out.push(`vault_root: ${vaultRoot}`)
    out.push(`thresholds: max_inline_edges=${formatLimit(options.maxInlineEdges)}, max_inline_nodes=${formatLimit(options.maxInlineNodes)}, max_depth=${options.maxDepth}`)
    out.push(`fragment_count: ${fragments.length}`)
    out.push('')
    for (const fragment of fragments) {
        out.push(fragment.id === 'main' ? '[Main view]' : `[Fragment ${fragment.id}: ${fragment.label}]`)
        out.push(`summary: nodes=${fragment.stats.nodeCount}, inline_edges=${fragment.stats.inlineEdgeCount}, footer_edges=${fragment.stats.footerEdgeCount}, a=${fragment.stats.arboricity}`)
        out.push(...fragment.lines)
        if (fragment.footerLines.length > 0) {
            out.push('')
            out.push('[Cross-Links]')
            out.push(...fragment.footerLines)
        }
        out.push('')
    }

    return {text: out.join('\n').trimEnd() + '\n', fragments, nodeToFragment}
}

function parseArgs(argv: readonly string[]): {vaultRoot: string; statePath: string | null; options: RecursiveRenderOptions} {
    const positionals: string[] = []
    let statePath: string | null = null
    let maxInlineEdges: number = DEFAULTS.maxInlineEdges
    let maxInlineNodes: number = DEFAULTS.maxInlineNodes
    let maxDepth: number = DEFAULTS.maxDepth
    for (let i = 0; i < argv.length; i++) {
        const arg: string = argv[i]!
        if (arg === '--state') {statePath = path.resolve(argv[++i]!); continue}
        if (arg === '--max-inline-edges') {maxInlineEdges = parseLimit(argv[++i], DEFAULTS.maxInlineEdges); continue}
        if (arg === '--max-inline-nodes') {maxInlineNodes = parseLimit(argv[++i], DEFAULTS.maxInlineNodes); continue}
        if (arg === '--max-depth') {
            maxDepth = Number(argv[++i])
            if (!Number.isFinite(maxDepth) || maxDepth < 0) throw new Error(`Invalid max depth: ${argv[i]}`)
            continue
        }
        positionals.push(arg)
    }
    if (positionals.length !== 1) {
        throw new Error('Usage: L3-BF-194-recursive-ascii.ts <vault-root> [--state <state.json>] [--max-inline-edges N|inf] [--max-inline-nodes N|inf] [--max-depth N]')
    }
    return {
        vaultRoot: path.resolve(positionals[0]!),
        statePath,
        options: {maxInlineEdges, maxInlineNodes, maxDepth},
    }
}

function main(): void {
    const {vaultRoot, statePath, options} = parseArgs(process.argv.slice(2))
    const state: JsonState = statePath
        ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
        : loadStateFromRoot(vaultRoot)
    const inferredRoot: string = statePath ? (vaultRoot || lcpOfIds(Object.keys(state.graph.nodes))) : vaultRoot
    process.stdout.write(buildRecursiveAscii(state, inferredRoot, options).text)
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main()
}

export {
    DEFAULTS,
    buildFolderTree,
    buildRecursiveAscii,
    computeFolderStats,
    formatLimit,
    loadStateFromRoot,
    parseLimit,
    planExtractions,
    shouldExtract,
}
export type {
    ExtractPlan,
    FileInfo,
    FolderNode,
    FolderStats,
    FragmentRender,
    FragmentStats,
    RecursiveRender,
    RecursiveRenderOptions,
}
