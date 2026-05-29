import {execFileSync} from 'node:child_process'
import {readdir, readFile, stat} from 'node:fs/promises'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {JSDOM} from 'jsdom'
import {describe, expect, it} from 'vitest'
import {type PackageInfo} from '../../_shared/discovery/discover-packages'
import {buildImportGraph} from '../../_shared/graph/import-graph'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

export type ArchitectureNode = {
    readonly id: string
}

export type ArchitectureEdge = {
    readonly from: string
    readonly to: string
    readonly label: string
    readonly raw: string
}

export type DiagramSpec = {
    readonly absPath: string
    readonly nodes: readonly ArchitectureNode[]
    readonly edges: readonly ArchitectureEdge[]
    readonly clickPaths: ReadonlyMap<string, string>
    readonly refinesParentNodeId: string | null
    readonly parseErrors: readonly string[]
}

export type ParsedArchitectureFile = DiagramSpec & {
    readonly repoRoot: string
}

export type RefinementLink = {
    readonly child: ParsedArchitectureFile
    readonly parent: ParsedArchitectureFile
    readonly parentNodeId: string
    readonly parentClickTarget: string
}

export type RefinementTree = {
    readonly filesByPath: ReadonlyMap<string, ParsedArchitectureFile>
    readonly links: readonly RefinementLink[]
    readonly failures: readonly string[]
}

type NodeSourceScope = {
    readonly nodeId: string
    readonly absTarget: string
    readonly isDirectory: boolean
}

type SourceImportEdge = {
    readonly fromNodeId: string
    readonly toNodeId: string
    readonly importerAbsPath: string
    readonly importedAbsPath: string
}

const EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set([
    'node_modules',
    'dist',
    'dist-electron',
    'dist-test',
    'out',
    'build',
    '.git',
    '.venv',
    'coverage',
    // TODO: drop once migrate-worktrees-to-sibling.sh has run and .worktrees/ is empty.
    '.worktrees',
    '__tests__',
])

const EXCLUDED_RELATIVE_PATHS: ReadonlySet<string> = new Set([
    'brain',
    'vt-website-quartz',
    'voicetree-evals',
])

const THIS_FILE = fileURLToPath(import.meta.url)
const REPO_ROOT = resolve(THIS_FILE, '..', '..', '..', '..', '..', '..')
const ARCHITECTURE_FILE_NAME = 'architecture.md'

let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null

function relativePath(absPath: string, repoRoot: string): string {
    const path = relative(repoRoot, absPath).split(sep).join('/')
    return path === '' ? '.' : path
}

function parseRefinesFrontmatter(markdown: string): string | null {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(markdown)
    if (!match) return null
    const refines = /^refines:\s*([A-Za-z][A-Za-z0-9_-]*)\s*$/m.exec(match[1])
    return refines?.[1] ?? null
}

function extractFlowchartBlocks(markdown: string): readonly string[] {
    const blocks: string[] = []
    const blockPattern = /```mermaid\s*\r?\n([\s\S]*?)```/g
    for (const match of markdown.matchAll(blockPattern)) {
        const body = match[1].trim()
        if (/^flowchart\b/m.test(body)) blocks.push(body)
    }
    return blocks
}

function stripComment(line: string): string {
    const commentIndex = line.indexOf('%%')
    return (commentIndex === -1 ? line : line.slice(0, commentIndex)).trim().replace(/;$/, '').trim()
}

function parseNodeId(token: string): string | null {
    const trimmed = token.trim()
    const match = /^([A-Za-z][A-Za-z0-9_-]*)/.exec(trimmed)
    return match?.[1] ?? null
}

function hasNodeShape(token: string): boolean {
    return /^[A-Za-z][A-Za-z0-9_-]*\s*(?:\[|\(|\{|\(\(|\[\[|\{\{)/.test(token.trim())
}

function parseClick(line: string): readonly [string, string] | null {
    const match = /^click\s+([A-Za-z][A-Za-z0-9_-]*)\s+"([^"]+)"(?:\s|$)/.exec(line)
    return match ? [match[1], match[2]] : null
}

function parseEdge(line: string): ArchitectureEdge | null {
    const match = /^(.+?)\s+-->\s*(.+)$/.exec(line)
    if (!match) return null
    const from = parseNodeId(match[1])
    if (!from) return null

    const afterArrow = match[2].trim()
    const labeledTarget = /^\|([^|]*)\|\s*(.+)$/.exec(afterArrow)
    const label = labeledTarget ? labeledTarget[1].trim() : ''
    const targetToken = labeledTarget ? labeledTarget[2] : afterArrow
    const to = parseNodeId(targetToken)
    if (!to) return null

    return {from, to, label, raw: line}
}

function parseNodeDeclaration(line: string): string | null {
    if (!hasNodeShape(line)) return null
    return parseNodeId(line)
}

function collectNodeIds(
    explicitNodeIds: readonly string[],
    edges: readonly ArchitectureEdge[],
    clickPaths: ReadonlyMap<string, string>,
): readonly ArchitectureNode[] {
    const nodeIds = new Set<string>()
    for (const id of explicitNodeIds) nodeIds.add(id)
    for (const edge of edges) {
        nodeIds.add(edge.from)
        nodeIds.add(edge.to)
    }
    for (const id of clickPaths.keys()) nodeIds.add(id)
    return [...nodeIds].sort((a, b) => a.localeCompare(b)).map(id => ({id}))
}

function parseFlowchartContract(flowchart: string): Omit<DiagramSpec, 'absPath' | 'refinesParentNodeId'> {
    const explicitNodeIds: string[] = []
    const duplicateNodeIds: string[] = []
    const seenExplicitNodes = new Set<string>()
    const edges: ArchitectureEdge[] = []
    const clickEntries = new Map<string, string>()
    const duplicateClickIds: string[] = []

    for (const rawLine of flowchart.split(/\r?\n/)) {
        const line = stripComment(rawLine)
        if (line === '' || /^flowchart\b/.test(line)) continue
        if (/^(subgraph|end|classDef|class|style|linkStyle)\b/.test(line)) continue

        const click = parseClick(line)
        if (click) {
            const [id, path] = click
            if (clickEntries.has(id)) duplicateClickIds.push(id)
            clickEntries.set(id, path)
            continue
        }

        const edge = parseEdge(line)
        if (edge) {
            edges.push(edge)
            continue
        }

        const nodeId = parseNodeDeclaration(line)
        if (nodeId) {
            if (seenExplicitNodes.has(nodeId)) duplicateNodeIds.push(nodeId)
            seenExplicitNodes.add(nodeId)
            explicitNodeIds.push(nodeId)
        }
    }

    const parseErrors = [
        ...duplicateNodeIds.map(id =>
            `Node id '${id}' is declared more than once in the Mermaid flowchart. Reconcile the diagram so each node has one declaration.`,
        ),
        ...duplicateClickIds.map(id =>
            `Node id '${id}' has more than one click directive. Reconcile the diagram so the node binds to exactly one code path.`,
        ),
    ]

    return {
        nodes: collectNodeIds(explicitNodeIds, edges, clickEntries),
        edges,
        clickPaths: clickEntries,
        parseErrors,
    }
}

async function assertMermaidSyntax(flowchart: string, absPath: string): Promise<readonly string[]> {
    const globalWithWindow = globalThis as typeof globalThis & {window?: unknown}
    if (!globalWithWindow.window) {
        globalWithWindow.window = new JSDOM('').window
    }
    mermaidModulePromise ??= import('mermaid')
    const mermaid = (await mermaidModulePromise).default
    mermaid.initialize({startOnLoad: false})
    try {
        await mermaid.parse(flowchart, {suppressErrors: false})
        return []
    } catch (cause) {
        return [
            `File ${absPath} contains Mermaid syntax that the official parser rejected: ${(cause as Error).message}. Reconcile the diagram syntax before changing code.`,
        ]
    }
}

export async function parseArchitectureMd(absPath: string): Promise<DiagramSpec> {
    const markdown = await readFile(absPath, 'utf8')
    const blocks = extractFlowchartBlocks(markdown)
    if (blocks.length !== 1) {
        return {
            absPath,
            nodes: [],
            edges: [],
            clickPaths: new Map(),
            refinesParentNodeId: parseRefinesFrontmatter(markdown),
            parseErrors: [
                `File ${absPath} contains ${blocks.length} Mermaid flowchart blocks; architecture.md must contain exactly one. Reconcile the diagram file.`,
            ],
        }
    }

    const contract = parseFlowchartContract(blocks[0])
    return {
        absPath,
        ...contract,
        refinesParentNodeId: parseRefinesFrontmatter(markdown),
        parseErrors: [
            ...await assertMermaidSyntax(blocks[0], absPath),
            ...contract.parseErrors,
        ],
    }
}

async function pathExists(absPath: string): Promise<boolean> {
    try {
        await stat(absPath)
        return true
    } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw cause
    }
}

function isGitIgnored(repoRoot: string, absPath: string): boolean {
    const rel = relativePath(absPath, repoRoot)
    try {
        execFileSync('git', ['check-ignore', '-q', '--', rel], {
            cwd: repoRoot,
            stdio: 'ignore',
        })
        return true
    } catch (cause) {
        const status = (cause as {status?: number}).status
        if (status === 1 || status === 128) return false
        throw cause
    }
}

async function isDirectory(absPath: string): Promise<boolean> {
    return (await stat(absPath)).isDirectory()
}

async function statOrNull(absPath: string) {
    try {
        return await stat(absPath)
    } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw cause
    }
}

function shouldSkipDirectory(entryName: string, childRel: string): boolean {
    return EXCLUDED_DIR_NAMES.has(entryName) || EXCLUDED_RELATIVE_PATHS.has(childRel.split(sep).join('/'))
}

export async function discoverArchitectureFiles(repoRoot: string = REPO_ROOT): Promise<readonly ParsedArchitectureFile[]> {
    const found: string[] = []

    async function walk(absDir: string, relDir: string): Promise<void> {
        const architecturePath = join(absDir, ARCHITECTURE_FILE_NAME)
        if (await pathExists(architecturePath) && !isGitIgnored(repoRoot, architecturePath)) {
            found.push(architecturePath)
        }

        const entries = await readdir(absDir, {withFileTypes: true})
        await Promise.all(entries.map(async entry => {
            if (!entry.isDirectory()) return
            const childRel = relDir ? join(relDir, entry.name) : entry.name
            if (shouldSkipDirectory(entry.name, childRel)) return
            await walk(join(absDir, entry.name), childRel)
        }))
    }

    await walk(repoRoot, '')
    const parsed = await Promise.all(found.sort((a, b) => a.localeCompare(b)).map(parseArchitectureMd))
    return parsed.map(file => ({...file, repoRoot}))
}

function isSamePathOrInside(parentAbsPath: string, childAbsPath: string): boolean {
    const rel = relative(parentAbsPath, childAbsPath)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function findScopeForPath(scopes: readonly NodeSourceScope[], absPath: string): NodeSourceScope | null {
    const matching = scopes.filter(scope => scope.isDirectory
        ? isSamePathOrInside(scope.absTarget, absPath)
        : scope.absTarget === absPath)
    return matching.sort((a, b) => b.absTarget.length - a.absTarget.length)[0] ?? null
}

async function sourceScopes(file: ParsedArchitectureFile): Promise<readonly NodeSourceScope[]> {
    const entries = await Promise.all([...file.clickPaths.entries()].map(async ([nodeId, clickPath]) => {
        if (isAbsolute(clickPath)) return null
        const absTarget = resolve(file.repoRoot, clickPath)
        if (absTarget === file.repoRoot) return null
        const targetStat = await statOrNull(absTarget)
        if (!targetStat) return null
        return {
            nodeId,
            absTarget,
            isDirectory: targetStat.isDirectory(),
        }
    }))
    return entries.filter((entry): entry is NodeSourceScope => entry !== null)
}

async function collectSourceImportEdges(file: ParsedArchitectureFile): Promise<readonly SourceImportEdge[]> {
    const scopes = await sourceScopes(file)
    if (scopes.length === 0) return []

    const packages: readonly PackageInfo[] = scopes.map(scope => ({
        name: scope.nodeId,
        dirName: scope.nodeId,
        srcRoot: scope.absTarget,
        absDir: scope.isDirectory ? scope.absTarget : resolve(scope.absTarget, '..'),
    }))
    const importGraph = await buildImportGraph(packages, file.repoRoot)

    return importGraph.edges.flatMap(edge => {
        const fromScope = findScopeForPath(scopes, edge.from.absolutePath)
        const toScope = findScopeForPath(scopes, edge.to.absolutePath)
        if (!fromScope || !toScope || toScope.nodeId === fromScope.nodeId) return []
        return [{
            fromNodeId: fromScope.nodeId,
            toNodeId: toScope.nodeId,
            importerAbsPath: edge.from.absolutePath,
            importedAbsPath: edge.to.absolutePath,
        }]
    })
}

async function validateSourceEdges(file: ParsedArchitectureFile): Promise<readonly string[]> {
    const relFile = relativePath(file.absPath, file.repoRoot)
    const declaredEdges = new Set(file.edges.map(edge => `${edge.from}->${edge.to}`))
    const sourceEdges = await collectSourceImportEdges(file)
    const missingEdges = sourceEdges.filter(edge => !declaredEdges.has(`${edge.fromNodeId}->${edge.toNodeId}`))
    const dedupedFailures = new Set(missingEdges.map(edge =>
        `Source file '${relativePath(edge.importerAbsPath, file.repoRoot)}' imports '${relativePath(edge.importedAbsPath, file.repoRoot)}', creating source edge '${edge.fromNodeId} --> ${edge.toNodeId}' that is not declared in ${relFile}. Reconcile by removing the source dependency or adding a labeled architecture edge if the dependency is intentional.`,
    ))
    return [...dedupedFailures].sort()
}

function validatePerFile(file: ParsedArchitectureFile): readonly string[] {
    const relFile = relativePath(file.absPath, file.repoRoot)
    const connectedNodeIds = new Set(file.edges.flatMap(edge => [edge.from, edge.to]))
    return [
        ...file.parseErrors,
        ...file.nodes.flatMap(node => file.clickPaths.has(node.id)
            ? []
            : [`Node '${node.id}' in ${relFile} has no click directive. Reconcile the diagram by adding click ${node.id} "<path>" or remove the stale node.`]),
        ...file.edges.flatMap(edge => edge.label.length > 0
            ? []
            : [`Edge '${edge.from} --> ${edge.to}' in ${relFile} has no channel label. Reconcile the diagram by adding a non-empty |channel| label.`]),
        ...file.nodes.flatMap(node => connectedNodeIds.has(node.id)
            ? []
            : [`Node '${node.id}' in ${relFile} has no incoming or outgoing edge. Reconcile the diagram by connecting it to the architecture or remove the stale node.`]),
    ]
}

async function validateClickTargets(file: ParsedArchitectureFile): Promise<readonly string[]> {
    const relFile = relativePath(file.absPath, file.repoRoot)
    const failures: string[] = []
    for (const [nodeId, clickPath] of file.clickPaths.entries()) {
        if (isAbsolute(clickPath)) {
            failures.push(`Node '${nodeId}' in ${relFile} uses absolute click target '${clickPath}'. Reconcile the diagram with a repo-relative path.`)
            continue
        }
        const absTarget = resolve(file.repoRoot, clickPath)
        if (!(await pathExists(absTarget))) {
            failures.push(
                `Node '${nodeId}' in ${relFile} points at missing click target '${clickPath}'. Reconcile by restoring the file/directory or updating the diagram.`,
            )
        }
    }
    return failures
}

function nearestAncestor(file: ParsedArchitectureFile, filesByPath: ReadonlyMap<string, ParsedArchitectureFile>): ParsedArchitectureFile | null {
    let dir = resolve(file.absPath, '..')
    while (dir !== file.repoRoot) {
        dir = resolve(dir, '..')
        const candidate = filesByPath.get(join(dir, ARCHITECTURE_FILE_NAME))
        if (candidate) return candidate
    }
    return null
}

export function buildRefinementTree(files: readonly ParsedArchitectureFile[]): RefinementTree {
    const filesByPath = new Map(files.map(file => [resolve(file.absPath), file]))
    const links: RefinementLink[] = []
    const failures: string[] = []

    for (const file of files) {
        if (resolve(file.absPath) === join(file.repoRoot, ARCHITECTURE_FILE_NAME)) {
            if (file.refinesParentNodeId !== null) {
                failures.push(`Root architecture.md declares refines: ${file.refinesParentNodeId}. Reconcile the diagram by removing root frontmatter; only descendant files refine parent nodes.`)
            }
            continue
        }

        const relFile = relativePath(file.absPath, file.repoRoot)
        const parent = nearestAncestor(file, filesByPath)
        if (!parent) {
            failures.push(`Descendant file ${relFile} has no ancestor architecture.md. Reconcile the diagram tree by adding an ancestor file or moving this file under the root architecture.`)
            continue
        }
        if (!file.refinesParentNodeId) {
            failures.push(`Descendant file ${relFile} is missing refines: <parent-node-id>. Reconcile the diagram by naming the parent node it refines.`)
            continue
        }
        const parentNode = parent.nodes.find(node => node.id === file.refinesParentNodeId)
        if (!parentNode) {
            failures.push(`Descendant file ${relFile} declares refines: ${file.refinesParentNodeId}, but that node does not exist in nearest ancestor ${relativePath(parent.absPath, file.repoRoot)}. Reconcile the child frontmatter or parent diagram node id.`)
            continue
        }
        const parentClickTarget = parent.clickPaths.get(parentNode.id)
        if (!parentClickTarget) {
            failures.push(`Descendant file ${relFile} refines node '${parentNode.id}', but the parent node has no click target. Reconcile the parent diagram before adding descendants.`)
            continue
        }
        links.push({
            child: file,
            parent,
            parentNodeId: parentNode.id,
            parentClickTarget,
        })
    }

    return {filesByPath, links, failures}
}

async function validateRefinementSubtree(link: RefinementLink): Promise<readonly string[]> {
    const relFile = relativePath(link.child.absPath, link.child.repoRoot)
    const parentAbsTarget = resolve(link.child.repoRoot, link.parentClickTarget)
    if (!(await pathExists(parentAbsTarget))) {
        return [`Descendant file ${relFile} refines node '${link.parentNodeId}', but the parent click target '${link.parentClickTarget}' does not exist. Reconcile the parent diagram or restore the code path before validating descendants.`]
    }
    const parentSubtree = await isDirectory(parentAbsTarget) ? parentAbsTarget : resolve(parentAbsTarget, '..')
    const failures: string[] = []
    for (const [nodeId, clickPath] of link.child.clickPaths.entries()) {
        const absClickTarget = resolve(link.child.repoRoot, clickPath)
        const relToParent = relative(parentSubtree, absClickTarget)
        if (relToParent.startsWith('..') || isAbsolute(relToParent)) {
            failures.push(
                `Descendant file ${relFile} node '${nodeId}' click target '${clickPath}' escapes parent subtree '${relativePath(parentSubtree, link.child.repoRoot)}'. Reconcile the child diagram or the parent node click target.`,
            )
        }
    }
    return failures
}

export async function validateArchitectureDrift(repoRoot: string = REPO_ROOT): Promise<readonly string[]> {
    const files = await discoverArchitectureFiles(repoRoot)
    if (files.length === 0) {
        return [`No architecture.md files found under ${repoRoot}. Reconcile by adding /architecture.md as the architecture contract.`]
    }
    const refinementTree = buildRefinementTree(files)
    const clickTargetFailures = await Promise.all(files.map(validateClickTargets))
    const sourceEdgeFailures = await Promise.all(files.map(validateSourceEdges))
    const subtreeFailures = await Promise.all(refinementTree.links.map(validateRefinementSubtree))
    return [
        ...files.flatMap(validatePerFile),
        ...clickTargetFailures.flat(),
        ...sourceEdgeFailures.flat(),
        ...refinementTree.failures,
        ...subtreeFailures.flat(),
    ]
}

describe('architecture drift parser', () => {
    it('accepts a root and descendant fixture when diagrams and click targets align', async () => {
        const fixtureRoot = resolve(THIS_FILE, '..', '__tests__', 'architecture-drift', 'valid')
        await expect(validateArchitectureDrift(fixtureRoot)).resolves.toEqual([])
    })

    it('names the node and missing click target when a target is renamed', async () => {
        const fixtureRoot = resolve(THIS_FILE, '..', '__tests__', 'architecture-drift', 'missing-click-target')
        const failures = await validateArchitectureDrift(fixtureRoot)
        expect(failures).toContain(
            `Node 'graphd' in architecture.md points at missing click target 'packages/systems/graph-db-server/src/missing.ts'. Reconcile by restoring the file/directory or updating the diagram.`,
        )
    })

    it('names both endpoints when an edge has no channel label', async () => {
        const fixtureRoot = resolve(THIS_FILE, '..', '__tests__', 'architecture-drift', 'unlabeled-edge')
        const failures = await validateArchitectureDrift(fixtureRoot)
        expect(failures).toContain(
            `Edge 'renderer --> graphd' in architecture.md has no channel label. Reconcile the diagram by adding a non-empty |channel| label.`,
        )
    })

    it('names the child file and unresolved parent id when refines points nowhere', async () => {
        const fixtureRoot = resolve(THIS_FILE, '..', '__tests__', 'architecture-drift', 'bad-refines')
        const failures = await validateArchitectureDrift(fixtureRoot)
        expect(failures).toContain(
            `Descendant file packages/systems/graph-db-server/architecture.md declares refines: missingParent, but that node does not exist in nearest ancestor architecture.md. Reconcile the child frontmatter or parent diagram node id.`,
        )
    })

    it('names the child click target and parent subtree when a refinement escapes', async () => {
        const fixtureRoot = resolve(THIS_FILE, '..', '__tests__', 'architecture-drift', 'subtree-escape')
        const failures = await validateArchitectureDrift(fixtureRoot)
        expect(failures).toContain(
            `Descendant file packages/systems/graph-db-server/architecture.md node 'outside' click target 'packages/systems/agent-runtime/src/outside.ts' escapes parent subtree 'packages/systems/graph-db-server'. Reconcile the child diagram or the parent node click target.`,
        )
    })

    it('names source imports that create undeclared architecture edges', async () => {
        const fixtureRoot = resolve(THIS_FILE, '..', '__tests__', 'architecture-drift', 'source-edge-drift')
        const failures = await validateArchitectureDrift(fixtureRoot)
        expect(failures).toContain(
            `Source file 'webapp/src/shell/UI/App.tsx' imports 'packages/systems/graph-db-server/bin/vt-graphd.ts', creating source edge 'renderer --> graphd' that is not declared in architecture.md. Reconcile by removing the source dependency or adding a labeled architecture edge if the dependency is intentional.`,
        )
    })
})

describe('architecture drift', () => {
    it('keeps architecture.md structurally aligned with the codebase', async () => {
        const failures = await validateArchitectureDrift(REPO_ROOT)

        await recordHealthMetric({
            metricId: 'architecture-drift',
            metricName: 'Architecture Drift',
            description: 'Structural consistency between architecture.md Mermaid diagrams and repo paths.',
            category: 'Coupling',
            current: failures.length,
            budget: 0,
            comparison: 'lte',
            unit: 'violations',
            details: {failures},
        })

        expect(
            failures,
            failures.length === 0
                ? 'architecture.md matches structural architecture assertions.'
                : `Architecture drift failures:\n${failures.map(failure => `  ${failure}`).join('\n')}`,
        ).toEqual([])
    })
})
