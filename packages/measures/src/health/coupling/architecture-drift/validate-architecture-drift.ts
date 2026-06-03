import {basename, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {type PackageInfo} from '../../../_shared/discovery/discover-packages'
import {buildImportGraph} from '../../../_shared/graph/import-graph'
import {runGitWorktreeCommand} from '../../../_shared/discovery/run-git.ts'
import {statOrNull} from '../../../_shared/stat-or-null'
import {type DiagramSpec, parseArchitectureMd} from './architecture-contract'

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

// Directory names that never contain the tracked source the contract describes.
// Git already excludes build artifacts / ignored runtime data from discovery, so
// these are the names that survive as *tracked* paths we must still skip: test
// fixtures live under __tests__ and would otherwise be counted as real diagrams.
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
const REPO_ROOT = resolve(THIS_FILE, '..', '..', '..', '..', '..', '..', '..')
const ARCHITECTURE_FILE_NAME = 'architecture.md'

function relativePath(absPath: string, repoRoot: string): string {
    const path = relative(repoRoot, absPath).split(sep).join('/')
    return path === '' ? '.' : path
}

function isExcludedRelPath(rel: string): boolean {
    const segments = rel.split('/')
    return segments.some(segment => EXCLUDED_DIR_NAMES.has(segment))
        || EXCLUDED_RELATIVE_PATHS.has(segments[0])
}

// Enumerate every architecture.md git knows about that is NOT gitignored — i.e.
// tracked files plus untracked-but-not-ignored ones. Delegating to git means the
// walk never descends into ephemeral/runtime data (e.g. infra/perf-stack/storage/,
// whose Tempo WAL dirs churn and vanish mid-scan): git prunes ignored directories
// before it ever stats their contents, so the discovery cannot ENOENT on them.
function listNonIgnoredArchitectureFiles(repoRoot: string): readonly string[] {
    const stdout = runGitWorktreeCommand(
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', `*${ARCHITECTURE_FILE_NAME}`],
        repoRoot,
    )
    return stdout.split('\0').filter(rel => rel !== '')
}

export async function discoverArchitectureFiles(repoRoot: string = REPO_ROOT): Promise<readonly ParsedArchitectureFile[]> {
    const found = listNonIgnoredArchitectureFiles(repoRoot)
        .filter(rel => basename(rel) === ARCHITECTURE_FILE_NAME)
        .filter(rel => !isExcludedRelPath(rel))
        .map(rel => join(repoRoot, rel))
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
        if ((await statOrNull(absTarget)) === null) {
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
    const parentStat = await statOrNull(parentAbsTarget)
    if (!parentStat) {
        return [`Descendant file ${relFile} refines node '${link.parentNodeId}', but the parent click target '${link.parentClickTarget}' does not exist. Reconcile the parent diagram or restore the code path before validating descendants.`]
    }
    const parentSubtree = parentStat.isDirectory() ? parentAbsTarget : resolve(parentAbsTarget, '..')
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
