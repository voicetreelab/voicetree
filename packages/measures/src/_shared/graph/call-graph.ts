import { dirname, relative, resolve } from 'node:path'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
    Node,
    SyntaxKind,
    type FunctionDeclaration,
    type MethodDeclaration,
    type Node as MorphNode,
    type SourceFile,
    type VariableDeclaration,
} from 'ts-morph'
import { discoverPackages, type PackageInfo } from '../discovery/discover-packages'
import { createRepoTsMorphProject } from './repo-ts-morph-project'

export type FunctionNode = {
    readonly id: string
    readonly name: string
    readonly file: string
    readonly line: number
    readonly kind: 'function' | 'arrow' | 'method'
    readonly isExported: boolean
    readonly loc: number
    readonly folderAncestors: readonly string[]
}

export type CallGraph = {
    readonly nodes: ReadonlyMap<string, FunctionNode>
    readonly sourceFiles: readonly SourceFile[]
    callees(fnId: string): ReadonlySet<string>
    callers(fnId: string): ReadonlySet<string>
    reachableFrom(fnId: string): ReadonlySet<string>
    reachesAny(fnId: string, predicate: (n: FunctionNode) => boolean): boolean
    nodesInFolder(folder: string): readonly FunctionNode[]
}

const TEST_DIR: string = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT: string = resolve(TEST_DIR, '../../../../..')

let graphPromise: Promise<CallGraph> | undefined

/**
 * Build a CallGraph.
 *
 * - `buildCallGraph()` — whole-repo, cached (module-scope promise).
 * - `buildCallGraph(repoRoot, packages?)` — whole-repo at an explicit root
 *   (used by health tests that need to control workspace resolution).
 *   Uncached.
 * - `buildCallGraph({sourceFiles, rootDir})` — custom set of ts-morph
 *   SourceFiles (used by the cgcli `loadGraph` path and its fixture
 *   tests). Uncached.
 */
export async function buildCallGraph(): Promise<CallGraph>
export async function buildCallGraph(repoRoot: string, packages?: readonly PackageInfo[]): Promise<CallGraph>
export async function buildCallGraph(opts: {readonly sourceFiles: readonly SourceFile[]; readonly rootDir: string}): Promise<CallGraph>
export async function buildCallGraph(
    arg?: string | {readonly sourceFiles: readonly SourceFile[]; readonly rootDir: string},
    packages?: readonly PackageInfo[],
): Promise<CallGraph> {
    if (typeof arg === 'object') return createCallGraphFromSourceFiles(arg.sourceFiles, arg.rootDir)
    if (typeof arg === 'string') return buildRepoCallGraph(arg, packages)
    graphPromise ??= buildRepoCallGraph(DEFAULT_REPO_ROOT)
    return graphPromise
}

function createCallGraphFromSourceFiles(
    sourceFiles: readonly SourceFile[],
    rootDir: string,
): CallGraph {
    const {nodes, functionIdsBySyntaxNode} = collectFunctionNodes(sourceFiles, rootDir)
    const {calleeIdsByFnId, callerIdsByFnId} = collectCallEdges(nodes, functionIdsBySyntaxNode)
    return assembleGraph(nodes, sourceFiles, calleeIdsByFnId, callerIdsByFnId)
}

async function buildRepoCallGraph(repoRoot: string, packages?: readonly PackageInfo[]): Promise<CallGraph> {
    const project = createRepoTsMorphProject(repoRoot, packages ?? await discoverPackages(repoRoot))
    const sourcePaths = await discoverProductionSourcePaths(repoRoot)
    const sourceFiles = project.addSourceFilesAtPaths(sourcePaths)
    if (sourceFiles.length === 0) {
        throw new Error('buildCallGraph found 0 production source files; check for concurrent package moves before changing globs')
    }
    return createCallGraphFromSourceFiles(sourceFiles, repoRoot)
}

async function discoverProductionSourcePaths(repoRoot: string): Promise<string[]> {
    const roots = [
        resolve(repoRoot, 'packages', 'libraries'),
        resolve(repoRoot, 'packages', 'systems'),
        resolve(repoRoot, 'webapp', 'src'),
    ]
    const nested = await Promise.all(roots.map(root => walkSourcePaths(root)))
    return nested.flat().filter(isProductionSourcePath).sort()
}

async function walkSourcePaths(dir: string): Promise<string[]> {
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
        entries = await readdir(dir, {withFileTypes: true})
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
    }
    const nested = await Promise.all(entries.map(async entry => {
        const path = resolve(dir, entry.name)
        if (entry.isDirectory()) {
            if (IGNORED_SOURCE_DIR_NAMES.has(entry.name)) return []
            return walkSourcePaths(path)
        }
        if (!entry.isFile() || (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx'))) return []
        return [path]
    }))
    return nested.flat()
}

const IGNORED_SOURCE_DIR_NAMES: ReadonlySet<string> = new Set([
    'node_modules',
    'dist',
    'build',
    '__tests__',
    '__generated__',
    'integration-tests',
    'tests',
    'scripts',
    'bin',
])

function collectFunctionNodes(
    sourceFiles: readonly SourceFile[],
    rootDir: string,
): {nodes: Map<string, FunctionNode>; functionIdsBySyntaxNode: Map<MorphNode, string>} {
    const nodes = new Map<string, FunctionNode>()
    const functionIdsBySyntaxNode = new Map<MorphNode, string>()
    for (const sourceFile of sourceFiles) {
        for (const fn of sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
            addFunctionDeclaration(nodes, functionIdsBySyntaxNode, sourceFile, fn, rootDir)
        }
        for (const method of sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) {
            addMethodDeclaration(nodes, functionIdsBySyntaxNode, sourceFile, method, rootDir)
        }
        for (const variable of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
            addVariableFunction(nodes, functionIdsBySyntaxNode, sourceFile, variable, rootDir)
        }
    }
    return {nodes, functionIdsBySyntaxNode}
}

function collectCallEdges(
    nodes: ReadonlyMap<string, FunctionNode>,
    functionIdsBySyntaxNode: ReadonlyMap<MorphNode, string>,
): {calleeIdsByFnId: Map<string, Set<string>>; callerIdsByFnId: Map<string, Set<string>>} {
    const calleeIdsByFnId = new Map<string, Set<string>>()
    const callerIdsByFnId = new Map<string, Set<string>>()
    for (const id of nodes.keys()) {
        calleeIdsByFnId.set(id, new Set())
        callerIdsByFnId.set(id, new Set())
    }
    for (const [syntaxNode, callerId] of functionIdsBySyntaxNode.entries()) {
        if (Node.isVariableDeclaration(syntaxNode)) continue
        for (const call of syntaxNode.getDescendantsOfKind(SyntaxKind.CallExpression)) {
            if (findEnclosingFunctionId(call, functionIdsBySyntaxNode) !== callerId) continue
            const calleeId = resolveCalleeId(call.getExpression(), functionIdsBySyntaxNode)
            if (!calleeId || calleeId === callerId) continue
            calleeIdsByFnId.get(callerId)?.add(calleeId)
            callerIdsByFnId.get(calleeId)?.add(callerId)
        }
    }
    return {calleeIdsByFnId, callerIdsByFnId}
}

function assembleGraph(
    nodes: ReadonlyMap<string, FunctionNode>,
    sourceFiles: readonly SourceFile[],
    calleeIdsByFnId: ReadonlyMap<string, ReadonlySet<string>>,
    callerIdsByFnId: ReadonlyMap<string, ReadonlySet<string>>,
): CallGraph {
    const graph: CallGraph = {
        nodes,
        sourceFiles,
        callees: (fnId: string): ReadonlySet<string> => calleeIdsByFnId.get(fnId) ?? new Set<string>(),
        callers: (fnId: string): ReadonlySet<string> => callerIdsByFnId.get(fnId) ?? new Set<string>(),
        reachableFrom: (fnId: string): ReadonlySet<string> => collectReachable(fnId, calleeIdsByFnId),
        reachesAny: (fnId: string, predicate: (n: FunctionNode) => boolean): boolean => {
            return reachesAny(fnId, calleeIdsByFnId, nodes, predicate)
        },
        nodesInFolder: (folder: string): readonly FunctionNode[] => {
            const normalizedFolder = normalizePath(folder).replace(/\/$/, '')
            return [...nodes.values()].filter(node =>
                normalizedFolder === ''
                || node.folderAncestors.includes(normalizedFolder))
        },
    }
    return graph
}

function isProductionSourcePath(path: string): boolean {
    const normalized = normalizePath(path)
    return !normalized.endsWith('.d.ts')
        && !normalized.endsWith('.test.ts')
        && !normalized.endsWith('.test.tsx')
        && !normalized.endsWith('.spec.ts')
        && !normalized.endsWith('.spec.tsx')
        && !normalized.endsWith('.config.ts')
        && !normalized.includes('/__tests__/')
        && !normalized.includes('/__generated__/')
        && !normalized.includes('/integration-tests/')
        && !normalized.includes('/node_modules/')
        && !normalized.includes('/dist/')
        && !normalized.includes('/build/')
        // Package scripts and bin entrypoints are shell/edge code. The call graph
        // is used by purity/coupling metrics that should measure core source.
        && !normalized.includes('/scripts/')
        && !normalized.includes('/bin/')
        && !normalized.includes('/tests/')
}

function addFunctionDeclaration(
    nodes: Map<string, FunctionNode>,
    functionIdsBySyntaxNode: Map<MorphNode, string>,
    sourceFile: SourceFile,
    fn: FunctionDeclaration,
    rootDir: string,
): void {
    if (!fn.getBody()) return
    const name = fn.getName() ?? 'default'
    const node = createFunctionNode(sourceFile, fn.getNameNode() ?? fn, fn, name, 'function', fn.isExported(), rootDir)
    nodes.set(node.id, node)
    functionIdsBySyntaxNode.set(fn, node.id)
}

function addMethodDeclaration(
    nodes: Map<string, FunctionNode>,
    functionIdsBySyntaxNode: Map<MorphNode, string>,
    sourceFile: SourceFile,
    method: MethodDeclaration,
    rootDir: string,
): void {
    if (!method.getBody()) return
    const classDecl = method.getParentIfKind(SyntaxKind.ClassDeclaration)
    const name = method.getName()
    const node = createFunctionNode(sourceFile, method.getNameNode(), method, name, 'method', classDecl?.isExported() ?? false, rootDir)
    nodes.set(node.id, node)
    functionIdsBySyntaxNode.set(method, node.id)
}

function addVariableFunction(
    nodes: Map<string, FunctionNode>,
    functionIdsBySyntaxNode: Map<MorphNode, string>,
    sourceFile: SourceFile,
    variable: VariableDeclaration,
    rootDir: string,
): void {
    const initializer = variable.getInitializer()
    if (!initializer || (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))) return
    if (!Node.isIdentifier(variable.getNameNode())) return
    const name = variable.getName()
    const variableStatement = variable.getVariableStatement()
    const node = createFunctionNode(
        sourceFile,
        variable.getNameNode(),
        initializer,
        name,
        Node.isArrowFunction(initializer) ? 'arrow' : 'function',
        variableStatement?.isExported() ?? false,
        rootDir,
    )
    nodes.set(node.id, node)
    functionIdsBySyntaxNode.set(variable, node.id)
    functionIdsBySyntaxNode.set(initializer, node.id)
}

function createFunctionNode(
    sourceFile: SourceFile,
    locationNode: MorphNode,
    node: MorphNode,
    name: string,
    kind: FunctionNode['kind'],
    isExported: boolean,
    rootDir: string,
): FunctionNode {
    const file = normalizePath(relative(rootDir, sourceFile.getFilePath()))
    const line = sourceFile.getLineAndColumnAtPos(locationNode.getStart()).line
    return {
        id: `${file}:${line}:${name}`,
        name,
        file,
        line,
        kind,
        isExported,
        loc: node.getEndLineNumber() - node.getStartLineNumber() + 1,
        folderAncestors: folderAncestors(file),
    }
}

function folderAncestors(file: string): readonly string[] {
    const folders: string[] = []
    let current = dirname(file)
    while (current !== '.' && current !== '') {
        folders.push(normalizePath(current))
        const parent = dirname(current)
        if (parent === current) break
        current = parent
    }
    return folders
}

function resolveCalleeId(
    expression: MorphNode,
    functionIdsBySyntaxNode: ReadonlyMap<MorphNode, string>,
): string | undefined {
    const symbol = expression.getSymbol()
    const resolved = symbol?.getAliasedSymbol() ?? symbol
    const declaration = resolved?.getValueDeclaration() ?? resolved?.getDeclarations()[0]
    if (!declaration) return undefined
    return findFunctionIdForDeclaration(declaration, functionIdsBySyntaxNode)
}

function findFunctionIdForDeclaration(
    declaration: MorphNode,
    functionIdsBySyntaxNode: ReadonlyMap<MorphNode, string>,
): string | undefined {
    let current: MorphNode | undefined = declaration
    while (current) {
        const id = functionIdsBySyntaxNode.get(current)
        if (id) return id
        current = current.getParent()
    }
    return undefined
}

function findEnclosingFunctionId(
    node: MorphNode,
    functionIdsBySyntaxNode: ReadonlyMap<MorphNode, string>,
): string | undefined {
    let current: MorphNode | undefined = node
    while (current) {
        const id = functionIdsBySyntaxNode.get(current)
        if (id) return id
        current = current.getParent()
    }
    return undefined
}

function collectReachable(fnId: string, calleeIdsByFnId: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
    const visited = new Set<string>()
    const visit = (current: string): void => {
        for (const callee of calleeIdsByFnId.get(current) ?? []) {
            if (visited.has(callee)) continue
            visited.add(callee)
            visit(callee)
        }
    }
    visit(fnId)
    visited.delete(fnId)
    return visited
}

function reachesAny(
    fnId: string,
    calleeIdsByFnId: ReadonlyMap<string, ReadonlySet<string>>,
    nodes: ReadonlyMap<string, FunctionNode>,
    predicate: (n: FunctionNode) => boolean,
): boolean {
    const visited = new Set<string>()
    const stack = [...(calleeIdsByFnId.get(fnId) ?? [])]
    while (stack.length > 0) {
        const current = stack.pop()
        if (!current || current === fnId || visited.has(current)) continue
        visited.add(current)
        const node = nodes.get(current)
        if (node && predicate(node)) return true
        for (const callee of calleeIdsByFnId.get(current) ?? []) stack.push(callee)
    }
    return false
}

function normalizePath(path: string): string {
    return path.replaceAll('\\', '/')
}
